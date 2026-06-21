package realtime

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"yapz/backend/internal/store"
)

type Hub struct {
	store      *store.Store
	register   chan *Client
	unregister chan *Client
	broadcast  chan Envelope
	clients    map[*Client]bool
	rooms      map[string]map[*Client]bool
	users      map[string]map[*Client]bool
	mu         sync.RWMutex
}

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan Envelope
	userID   string
	username string
	rooms    map[string]bool
}

type Envelope struct {
	Type      string          `json:"type"`
	ChannelID string          `json:"channelId,omitempty"`
	ServerID  string          `json:"serverId,omitempty"`
	UserID    string          `json:"userId,omitempty"`
	TargetID  string          `json:"targetId,omitempty"`
	Username  string          `json:"username,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func NewHub(store *store.Store) *Hub {
	return &Hub{
		store:      store,
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan Envelope, 256),
		clients:    map[*Client]bool{},
		rooms:      map[string]map[*Client]bool{},
		users:      map[string]map[*Client]bool{},
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			if h.users[client.userID] == nil {
				h.users[client.userID] = map[*Client]bool{}
			}
			h.users[client.userID][client] = true
			h.mu.Unlock()
		case client := <-h.unregister:
			h.removeClient(client)
		case msg := <-h.broadcast:
			h.mu.RLock()
			targets := h.rooms[msg.ChannelID]
			for client := range targets {
				select {
				case client.send <- msg:
				default:
					go h.removeClient(client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, userID, username string) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	client := &Client{
		hub:      h,
		conn:     conn,
		send:     make(chan Envelope, 32),
		userID:   userID,
		username: username,
		rooms:    map[string]bool{},
	}
	h.register <- client

	go client.writePump()
	go client.readPump()
}

func (h *Hub) Publish(envelope Envelope) {
	h.broadcast <- envelope
}

func (h *Hub) PublishToUser(userID string, envelope Envelope) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for client := range h.users[userID] {
		select {
		case client.send <- envelope:
		default:
			go h.removeClient(client)
		}
	}
}

func (h *Hub) join(client *Client, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[channelID] == nil {
		h.rooms[channelID] = map[*Client]bool{}
	}
	h.rooms[channelID][client] = true
	client.rooms[channelID] = true
}

func (h *Hub) removeClient(client *Client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[client]; !ok {
		return
	}
	delete(h.clients, client)
	delete(h.users[client.userID], client)
	if len(h.users[client.userID]) == 0 {
		delete(h.users, client.userID)
	}
	for room := range client.rooms {
		delete(h.rooms[room], client)
		if len(h.rooms[room]) == 0 {
			delete(h.rooms, room)
		}
	}
	close(client.send)
	_ = client.conn.Close()
}

func (c *Client) readPump() {
	defer func() { c.hub.unregister <- c }()
	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	})

	for {
		var msg Envelope
		if err := c.conn.ReadJSON(&msg); err != nil {
			return
		}
		msg.UserID = c.userID
		msg.Username = c.username

		switch msg.Type {
		case "join_channel":
			if ok, err := c.hub.store.IsChannelMember(context.Background(), msg.ChannelID, c.userID); err == nil && ok {
				c.hub.join(c, msg.ChannelID)
				c.send <- Envelope{Type: "channel_joined", ChannelID: msg.ChannelID}
			}
		case "voice_signal":
			if c.rooms[msg.ChannelID] {
				c.hub.PublishToUser(msg.TargetID, msg)
			}
		case "voice_join", "voice_leave", "typing":
			if c.rooms[msg.ChannelID] {
				c.hub.Publish(msg)
			}
		default:
			log.Printf("unknown ws type: %s", msg.Type)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteJSON(msg); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
