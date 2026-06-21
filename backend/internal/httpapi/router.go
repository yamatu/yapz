package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"yapz/backend/internal/auth"
	"yapz/backend/internal/config"
	"yapz/backend/internal/realtime"
	"yapz/backend/internal/store"
)

type API struct {
	cfg   config.Config
	store *store.Store
	hub   *realtime.Hub
}

type ctxKey string

const userKey ctxKey = "user"

func NewRouter(cfg config.Config, st *store.Store, hub *realtime.Hub) http.Handler {
	api := &API{cfg: cfg, store: st, hub: hub}
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", api.health)
	mux.HandleFunc("POST /api/auth/register", api.register)
	mux.HandleFunc("POST /api/auth/login", api.login)
	mux.Handle("GET /api/me", api.authenticated(http.HandlerFunc(api.me)))
	mux.Handle("POST /api/me/password", api.authenticated(http.HandlerFunc(api.changePassword)))
	mux.Handle("GET /api/servers", api.authenticated(http.HandlerFunc(api.listServers)))
	mux.Handle("POST /api/servers", api.authenticated(http.HandlerFunc(api.createServer)))
	mux.Handle("GET /api/servers/{serverID}/invite", api.authenticated(http.HandlerFunc(api.getInvite)))
	mux.Handle("GET /api/servers/{serverID}/channels", api.authenticated(http.HandlerFunc(api.listChannels)))
	mux.Handle("POST /api/servers/{serverID}/channels", api.authenticated(http.HandlerFunc(api.createChannel)))
	mux.Handle("DELETE /api/servers/{serverID}/channels/{channelID}", api.authenticated(http.HandlerFunc(api.deleteChannel)))
	mux.Handle("GET /api/servers/{serverID}/members", api.authenticated(http.HandlerFunc(api.listMembers)))
	mux.Handle("DELETE /api/servers/{serverID}/members/{memberID}", api.authenticated(http.HandlerFunc(api.removeMember)))
	mux.Handle("POST /api/invites/join", api.authenticated(http.HandlerFunc(api.joinInvite)))
	mux.Handle("GET /api/channels/{channelID}/messages", api.authenticated(http.HandlerFunc(api.listMessages)))
	mux.Handle("POST /api/channels/{channelID}/messages", api.authenticated(http.HandlerFunc(api.createMessage)))
	mux.Handle("GET /api/admin/users", api.adminOnly(http.HandlerFunc(api.adminUsers)))
	mux.Handle("GET /api/admin/servers", api.adminOnly(http.HandlerFunc(api.adminServers)))
	mux.Handle("GET /api/admin/channels", api.adminOnly(http.HandlerFunc(api.adminChannels)))
	mux.Handle("DELETE /api/admin/channels/{channelID}", api.adminOnly(http.HandlerFunc(api.adminDeleteChannel)))
	mux.Handle("GET /ws", api.authenticated(http.HandlerFunc(api.websocket)))

	return api.cors(mux)
}

func (a *API) adminOnly(next http.Handler) http.Handler {
	return a.authenticated(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if claimsFrom(r).Role != "admin" {
			writeError(w, http.StatusForbidden, "admin access required")
			return
		}
		next.ServeHTTP(w, r)
	}))
}

func (a *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			origin = a.cfg.CORSOrigin
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *API) authenticated(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			token = r.URL.Query().Get("token")
		}
		claims, err := auth.ParseJWT(a.cfg.JWTSecret, token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		ctx := context.WithValue(r.Context(), userKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(header, "Bearer ")
}

func claimsFrom(r *http.Request) *auth.Claims {
	claims, _ := r.Context().Value(userKey).(*auth.Claims)
	return claims
}

func (a *API) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) register(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Username = strings.TrimSpace(body.Username)
	body.Email = strings.TrimSpace(strings.ToLower(body.Email))
	if len(body.Username) < 2 || len(body.Password) < 8 || !strings.Contains(body.Email, "@") {
		writeError(w, http.StatusBadRequest, "invalid username, email, or password")
		return
	}
	hash, err := auth.HashPassword(body.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not hash password")
		return
	}
	user, err := a.store.CreateUser(r.Context(), body.Username, body.Email, hash)
	if err != nil {
		writeError(w, http.StatusConflict, "username or email already exists")
		return
	}
	token, _ := auth.SignJWT(a.cfg.JWTSecret, user.ID, user.Username, user.Role)
	writeJSON(w, http.StatusCreated, map[string]any{"token": token, "user": user})
}

func (a *API) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Login    string `json:"login"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	user, hash, err := a.store.FindUserByLogin(r.Context(), strings.TrimSpace(body.Login))
	if err != nil || !auth.CheckPassword(hash, body.Password) {
		writeError(w, http.StatusUnauthorized, "invalid login or password")
		return
	}
	token, _ := auth.SignJWT(a.cfg.JWTSecret, user.ID, user.Username, user.Role)
	writeJSON(w, http.StatusOK, map[string]any{"token": token, "user": user})
}

func (a *API) me(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	user, err := a.store.FindUserByID(r.Context(), claims.UserID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (a *API) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		CurrentPassword string `json:"currentPassword"`
		NextPassword    string `json:"nextPassword"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	if len(body.NextPassword) < 8 {
		writeError(w, http.StatusBadRequest, "next password must be at least 8 characters")
		return
	}
	if err := a.store.ChangePassword(r.Context(), claimsFrom(r).UserID, body.CurrentPassword, body.NextPassword); err != nil {
		writeError(w, http.StatusBadRequest, "current password is incorrect")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) listServers(w http.ResponseWriter, r *http.Request) {
	servers, err := a.store.ListServers(r.Context(), claimsFrom(r).UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list servers")
		return
	}
	writeJSON(w, http.StatusOK, servers)
}

func (a *API) createServer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		IconText    string `json:"iconText"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" {
		writeError(w, http.StatusBadRequest, "server name is required")
		return
	}
	if body.IconText == "" {
		body.IconText = strings.ToUpper(string([]rune(body.Name)[0]))
	}
	server, channels, err := a.store.CreateServer(r.Context(), claimsFrom(r).UserID, body.Name, body.Description, body.IconText)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create server")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"server": server, "channels": channels})
}

func (a *API) listChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := a.store.ListChannels(r.Context(), r.PathValue("serverID"), claimsFrom(r).UserID)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not list channels")
		return
	}
	writeJSON(w, http.StatusOK, channels)
}

func (a *API) getInvite(w http.ResponseWriter, r *http.Request) {
	invite, err := a.store.GetOrCreateInvite(r.Context(), r.PathValue("serverID"), claimsFrom(r).UserID)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not create invite")
		return
	}
	writeJSON(w, http.StatusOK, invite)
}

func (a *API) joinInvite(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Code string `json:"code"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	server, err := a.store.JoinByInvite(r.Context(), claimsFrom(r).UserID, body.Code)
	if err != nil {
		writeError(w, http.StatusNotFound, "invalid invite code")
		return
	}
	writeJSON(w, http.StatusOK, server)
}

func (a *API) createChannel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
		Kind string `json:"kind"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Name = strings.TrimSpace(body.Name)
	if body.Name == "" || (body.Kind != "text" && body.Kind != "voice") {
		writeError(w, http.StatusBadRequest, "invalid channel")
		return
	}
	channel, err := a.store.CreateChannel(r.Context(), r.PathValue("serverID"), claimsFrom(r).UserID, body.Name, body.Kind)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not create channel")
		return
	}
	writeJSON(w, http.StatusCreated, channel)
}

func (a *API) deleteChannel(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteChannel(r.Context(), r.PathValue("serverID"), claimsFrom(r).UserID, r.PathValue("channelID")); err != nil {
		writeError(w, http.StatusForbidden, "could not delete channel")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) listMembers(w http.ResponseWriter, r *http.Request) {
	members, err := a.store.ListMembers(r.Context(), r.PathValue("serverID"), claimsFrom(r).UserID)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not list members")
		return
	}
	writeJSON(w, http.StatusOK, members)
}

func (a *API) removeMember(w http.ResponseWriter, r *http.Request) {
	serverID := r.PathValue("serverID")
	memberID := r.PathValue("memberID")
	if err := a.store.RemoveServerMember(r.Context(), serverID, claimsFrom(r).UserID, memberID); err != nil {
		writeError(w, http.StatusForbidden, "could not remove member")
		return
	}
	payload, _ := json.Marshal(map[string]string{"serverId": serverID, "userId": memberID})
	a.hub.PublishToUser(memberID, realtime.Envelope{Type: "member_removed", ServerID: serverID, Payload: payload})
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) listMessages(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	messages, err := a.store.ListMessages(r.Context(), r.PathValue("channelID"), claimsFrom(r).UserID, limit)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not list messages")
		return
	}
	writeJSON(w, http.StatusOK, messages)
}

func (a *API) createMessage(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
	}
	if !decodeJSON(w, r, &body) {
		return
	}
	body.Content = strings.TrimSpace(body.Content)
	if body.Content == "" || len(body.Content) > 2000 {
		writeError(w, http.StatusBadRequest, "invalid message content")
		return
	}
	msg, err := a.store.CreateMessage(r.Context(), r.PathValue("channelID"), claimsFrom(r).UserID, body.Content)
	if err != nil {
		writeError(w, http.StatusForbidden, "could not create message")
		return
	}
	payload, _ := json.Marshal(msg)
	a.hub.Publish(realtime.Envelope{Type: "message_created", ChannelID: msg.ChannelID, Payload: payload})
	writeJSON(w, http.StatusCreated, msg)
}

func (a *API) websocket(w http.ResponseWriter, r *http.Request) {
	claims := claimsFrom(r)
	a.hub.ServeWS(w, r, claims.UserID, claims.Username)
}

func (a *API) adminUsers(w http.ResponseWriter, r *http.Request) {
	users, err := a.store.ListAdminUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list users")
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (a *API) adminServers(w http.ResponseWriter, r *http.Request) {
	servers, err := a.store.ListAdminServers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list servers")
		return
	}
	writeJSON(w, http.StatusOK, servers)
}

func (a *API) adminChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := a.store.ListAdminChannels(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not list channels")
		return
	}
	writeJSON(w, http.StatusOK, channels)
}

func (a *API) adminDeleteChannel(w http.ResponseWriter, r *http.Request) {
	if err := a.store.DeleteChannelAsAdmin(r.Context(), r.PathValue("channelID")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete channel")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func normalizeError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	return err
}
