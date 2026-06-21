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
	store       *store.Store
	register    chan *Client
	unregister  chan *Client
	broadcast   chan Envelope
	clients     map[*Client]bool
	rooms       map[string]map[*Client]bool
	serverRooms map[string]map[*Client]bool
	voiceRooms  map[string]map[string]*VoiceMember
	users       map[string]map[*Client]bool
	userCounts  map[string]int
	mu          sync.RWMutex
}

type VoiceMember struct {
	UserID   string `json:"userId"`
	Username string `json:"username"`
}

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	send     chan Envelope
	userID   string
	username string
	rooms    map[string]bool
	servers  map[string]bool
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
		store:       store,
		register:    make(chan *Client),
		unregister:  make(chan *Client),
		broadcast:   make(chan Envelope, 256),
		clients:     map[*Client]bool{},
		rooms:       map[string]map[*Client]bool{},
		serverRooms: map[string]map[*Client]bool{},
		voiceRooms:  map[string]map[string]*VoiceMember{},
		users:       map[string]map[*Client]bool{},
		userCounts:  map[string]int{},
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
			h.userCounts[client.userID]++
			if h.userCounts[client.userID] == 1 {
				go func() {
					_ = h.store.SetUserStatus(context.Background(), client.userID, "online")
					h.publishMemberStatus(client.userID, client.username, "online")
				}()
			}
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
		servers:  map[string]bool{},
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

func (h *Hub) joinServer(client *Client, serverID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.serverRooms[serverID] == nil {
		h.serverRooms[serverID] = map[*Client]bool{}
	}
	h.serverRooms[serverID][client] = true
	client.servers[serverID] = true
}

func (h *Hub) joinVoice(client *Client, channelID string) []VoiceMember {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.rooms[channelID] == nil {
		h.rooms[channelID] = map[*Client]bool{}
	}
	h.rooms[channelID][client] = true
	client.rooms[channelID] = true
	if h.voiceRooms[channelID] == nil {
		h.voiceRooms[channelID] = map[string]*VoiceMember{}
	}
	existing := make([]VoiceMember, 0, len(h.voiceRooms[channelID]))
	for id, member := range h.voiceRooms[channelID] {
		if id != client.userID {
			existing = append(existing, *member)
		}
	}
	h.voiceRooms[channelID][client.userID] = &VoiceMember{UserID: client.userID, Username: client.username}
	return existing
}

func (h *Hub) leaveVoice(client *Client, channelID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.voiceRooms[channelID], client.userID)
	if len(h.voiceRooms[channelID]) == 0 {
		delete(h.voiceRooms, channelID)
	}
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
	h.userCounts[client.userID]--
	if h.userCounts[client.userID] <= 0 {
		delete(h.userCounts, client.userID)
		go func() {
			_ = h.store.SetUserStatus(context.Background(), client.userID, "offline")
			h.publishMemberStatus(client.userID, client.username, "offline")
		}()
	}
	for room := range client.rooms {
		delete(h.rooms[room], client)
		delete(h.voiceRooms[room], client.userID)
		if len(h.voiceRooms[room]) == 0 {
			delete(h.voiceRooms, room)
		}
		if len(h.rooms[room]) == 0 {
			delete(h.rooms, room)
		}
	}
	for serverID := range client.servers {
		delete(h.serverRooms[serverID], client)
		if len(h.serverRooms[serverID]) == 0 {
			delete(h.serverRooms, serverID)
		}
	}
	close(client.send)
	_ = client.conn.Close()
}

func (h *Hub) publishMemberStatus(userID, username, status string) {
	serverIDs, err := h.store.ListMembershipServerIDs(context.Background(), userID)
	if err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"userId": userID, "username": username, "status": status})
	for _, serverID := range serverIDs {
		h.mu.RLock()
		targets := h.serverRooms[serverID]
		for client := range targets {
			select {
			case client.send <- Envelope{Type: "member_status", ServerID: serverID, UserID: userID, Username: username, Payload: payload}:
			default:
				go h.removeClient(client)
			}
		}
		h.mu.RUnlock()
	}
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
		case "join_server":
			if ok, err := c.hub.store.IsServerMember(context.Background(), msg.ServerID, c.userID); err == nil && ok {
				c.hub.joinServer(c, msg.ServerID)
				c.send <- Envelope{Type: "server_joined", ServerID: msg.ServerID}
			}
		case "join_channel":
			if ok, err := c.hub.store.IsChannelMember(context.Background(), msg.ChannelID, c.userID); err == nil && ok {
				c.hub.join(c, msg.ChannelID)
				c.send <- Envelope{Type: "channel_joined", ChannelID: msg.ChannelID}
			}
		case "voice_join":
			if c.rooms[msg.ChannelID] {
				existing := c.hub.joinVoice(c, msg.ChannelID)
				payload, _ := json.Marshal(existing)
				c.send <- Envelope{Type: "voice_members", ChannelID: msg.ChannelID, Payload: payload}
				c.hub.Publish(msg)
			}
		case "voice_leave":
			if c.rooms[msg.ChannelID] {
				c.hub.leaveVoice(c, msg.ChannelID)
				c.hub.Publish(msg)
			}
		case "voice_signal":
			if c.rooms[msg.ChannelID] {
				c.hub.PublishToUser(msg.TargetID, msg)
			}
		case "typing":
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
