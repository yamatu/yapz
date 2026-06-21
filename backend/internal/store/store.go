package store

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"strings"
	"time"

	"yapz/backend/internal/auth"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store struct {
	db *pgxpool.Pool
}

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	AvatarURL *string   `json:"avatarUrl"`
	Status    string    `json:"status"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"createdAt"`
}

type Server struct {
	ID          string    `json:"id"`
	OwnerID     string    `json:"ownerId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	IconText    string    `json:"iconText"`
	Role        string    `json:"role"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Channel struct {
	ID        string    `json:"id"`
	ServerID  string    `json:"serverId"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
}

type Message struct {
	ID        string    `json:"id"`
	ChannelID string    `json:"channelId"`
	AuthorID  string    `json:"authorId"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"createdAt"`
}

type Member struct {
	ID        string  `json:"id"`
	Username  string  `json:"username"`
	AvatarURL *string `json:"avatarUrl"`
	Status    string  `json:"status"`
	Role      string  `json:"role"`
}

type Invite struct {
	Code      string    `json:"code"`
	ServerID  string    `json:"serverId"`
	CreatedAt time.Time `json:"createdAt"`
}

type AdminUser struct {
	ID          string    `json:"id"`
	Username    string    `json:"username"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	ServerCount int       `json:"serverCount"`
	CreatedAt   time.Time `json:"createdAt"`
}

type AdminServer struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	OwnerID      string    `json:"ownerId"`
	OwnerName    string    `json:"ownerName"`
	MemberCount  int       `json:"memberCount"`
	ChannelCount int       `json:"channelCount"`
	CreatedAt    time.Time `json:"createdAt"`
}

type AdminChannel struct {
	ID         string    `json:"id"`
	ServerID   string    `json:"serverId"`
	ServerName string    `json:"serverName"`
	Name       string    `json:"name"`
	Kind       string    `json:"kind"`
	CreatedAt  time.Time `json:"createdAt"`
}

func New(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) CreateUser(ctx context.Context, username, email, passwordHash string) (User, error) {
	var u User
	err := s.db.QueryRow(ctx, `
		INSERT INTO users (username, email, password_hash, status)
		VALUES ($1, $2, $3, 'online')
		RETURNING id, username, email, avatar_url, status, role, created_at
	`, username, email, passwordHash).Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.Status, &u.Role, &u.CreatedAt)
	return u, err
}

func (s *Store) FindUserByLogin(ctx context.Context, login string) (User, string, error) {
	var u User
	var hash string
	err := s.db.QueryRow(ctx, `
		SELECT id, username, email, avatar_url, status, role, created_at, password_hash
		FROM users WHERE username = $1 OR email = $1
	`, login).Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.Status, &u.Role, &u.CreatedAt, &hash)
	return u, hash, err
}

func (s *Store) FindUserByID(ctx context.Context, id string) (User, error) {
	var u User
	err := s.db.QueryRow(ctx, `
		SELECT id, username, email, avatar_url, status, role, created_at
		FROM users WHERE id = $1
	`, id).Scan(&u.ID, &u.Username, &u.Email, &u.AvatarURL, &u.Status, &u.Role, &u.CreatedAt)
	return u, err
}

func (s *Store) SetUserStatus(ctx context.Context, userID, status string) error {
	_, err := s.db.Exec(ctx, `UPDATE users SET status = $1 WHERE id = $2`, status, userID)
	return err
}

func (s *Store) EnsureAdmin(ctx context.Context, username, email, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO users (username, email, password_hash, status, role)
		VALUES ($1, $2, $3, 'online', 'admin')
		ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash, role = 'admin'
	`, username, email, hash)
	return err
}

func (s *Store) ChangePassword(ctx context.Context, userID, currentPassword, nextPassword string) error {
	var hash string
	if err := s.db.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return err
	}
	if !auth.CheckPassword(hash, currentPassword) {
		return errors.New("current password is incorrect")
	}
	nextHash, err := auth.HashPassword(nextPassword)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(ctx, `UPDATE users SET password_hash = $1 WHERE id = $2`, nextHash, userID)
	return err
}

func (s *Store) CreateServer(ctx context.Context, ownerID, name, description, iconText string) (Server, []Channel, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return Server{}, nil, err
	}
	defer tx.Rollback(ctx)

	var srv Server
	err = tx.QueryRow(ctx, `
		INSERT INTO servers (owner_id, name, description, icon_text)
		VALUES ($1, $2, $3, $4)
		RETURNING id, owner_id, name, description, icon_text, created_at
	`, ownerID, name, description, iconText).Scan(&srv.ID, &srv.OwnerID, &srv.Name, &srv.Description, &srv.IconText, &srv.CreatedAt)
	if err != nil {
		return Server{}, nil, err
	}
	srv.Role = "owner"

	if _, err = tx.Exec(ctx, `INSERT INTO server_members (server_id, user_id, role) VALUES ($1, $2, 'owner')`, srv.ID, ownerID); err != nil {
		return Server{}, nil, err
	}

	rows, err := tx.Query(ctx, `
		INSERT INTO channels (server_id, name, kind, position)
		VALUES ($1, '大厅', 'text', 1), ($1, '开黑语音', 'voice', 2)
		RETURNING id, server_id, name, kind, position, created_at
	`, srv.ID)
	if err != nil {
		return Server{}, nil, err
	}
	channels, err := pgx.CollectRows(rows, pgx.RowToStructByName[Channel])
	if err != nil {
		return Server{}, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Server{}, nil, err
	}
	return srv, channels, nil
}

func (s *Store) ListServers(ctx context.Context, userID string) ([]Server, error) {
	rows, err := s.db.Query(ctx, `
		SELECT s.id, s.owner_id, s.name, s.description, s.icon_text, sm.role, s.created_at
		FROM servers s
		JOIN server_members sm ON sm.server_id = s.id
		WHERE sm.user_id = $1
		ORDER BY sm.joined_at
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	servers := make([]Server, 0)
	for rows.Next() {
		var srv Server
		if err := rows.Scan(&srv.ID, &srv.OwnerID, &srv.Name, &srv.Description, &srv.IconText, &srv.Role, &srv.CreatedAt); err != nil {
			return nil, err
		}
		servers = append(servers, srv)
	}
	return servers, rows.Err()
}

func (s *Store) IsServerMember(ctx context.Context, serverID, userID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM server_members WHERE server_id = $1 AND user_id = $2)`, serverID, userID).Scan(&exists)
	return exists, err
}

func (s *Store) IsChannelMember(ctx context.Context, channelID, userID string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM channels c
			JOIN server_members sm ON sm.server_id = c.server_id
			WHERE c.id = $1 AND sm.user_id = $2
		)
	`, channelID, userID).Scan(&exists)
	return exists, err
}

func (s *Store) ListChannels(ctx context.Context, serverID, userID string) ([]Channel, error) {
	ok, err := s.IsServerMember(ctx, serverID, userID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a server member")
		}
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT id, server_id, name, kind, position, created_at
		FROM channels
		WHERE server_id = $1
		ORDER BY position, created_at
	`, serverID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByName[Channel])
}

func (s *Store) CreateChannel(ctx context.Context, serverID, userID, name, kind string) (Channel, error) {
	ok, err := s.IsServerMember(ctx, serverID, userID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a server member")
		}
		return Channel{}, err
	}
	var ch Channel
	err = s.db.QueryRow(ctx, `
		INSERT INTO channels (server_id, name, kind, position)
		VALUES ($1, $2, $3, (SELECT COALESCE(MAX(position), 0) + 1 FROM channels WHERE server_id = $1))
		RETURNING id, server_id, name, kind, position, created_at
	`, serverID, name, kind).Scan(&ch.ID, &ch.ServerID, &ch.Name, &ch.Kind, &ch.Position, &ch.CreatedAt)
	return ch, err
}

func (s *Store) DeleteChannel(ctx context.Context, serverID, userID, channelID string) error {
	var role string
	if err := s.db.QueryRow(ctx, `SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, serverID, userID).Scan(&role); err != nil {
		return err
	}
	if role != "owner" {
		return errors.New("only owner can delete channels")
	}
	result, err := s.db.Exec(ctx, `DELETE FROM channels WHERE id = $1 AND server_id = $2`, channelID, serverID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return errors.New("channel not found")
	}
	return nil
}

func (s *Store) GetOrCreateInvite(ctx context.Context, serverID, userID string) (Invite, error) {
	ok, err := s.IsServerMember(ctx, serverID, userID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a server member")
		}
		return Invite{}, err
	}
	var invite Invite
	err = s.db.QueryRow(ctx, `
		SELECT code, server_id, created_at
		FROM server_invites
		WHERE server_id = $1
		ORDER BY created_at
		LIMIT 1
	`, serverID).Scan(&invite.Code, &invite.ServerID, &invite.CreatedAt)
	if err == nil {
		return invite, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Invite{}, err
	}
	code, err := inviteCode()
	if err != nil {
		return Invite{}, err
	}
	err = s.db.QueryRow(ctx, `
		INSERT INTO server_invites (server_id, code, created_by)
		VALUES ($1, $2, $3)
		RETURNING code, server_id, created_at
	`, serverID, code, userID).Scan(&invite.Code, &invite.ServerID, &invite.CreatedAt)
	return invite, err
}

func (s *Store) JoinByInvite(ctx context.Context, userID, code string) (Server, error) {
	var serverID string
	err := s.db.QueryRow(ctx, `SELECT server_id FROM server_invites WHERE code = $1`, strings.ToUpper(strings.TrimSpace(code))).Scan(&serverID)
	if err != nil {
		return Server{}, err
	}
	_, err = s.db.Exec(ctx, `
		INSERT INTO server_members (server_id, user_id, role)
		VALUES ($1, $2, 'member')
		ON CONFLICT (server_id, user_id) DO NOTHING
	`, serverID, userID)
	if err != nil {
		return Server{}, err
	}
	servers, err := s.ListServers(ctx, userID)
	if err != nil {
		return Server{}, err
	}
	for _, server := range servers {
		if server.ID == serverID {
			return server, nil
		}
	}
	return Server{}, errors.New("joined server not found")
}

func (s *Store) CreateMessage(ctx context.Context, channelID, authorID, content string) (Message, error) {
	ok, err := s.IsChannelMember(ctx, channelID, authorID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a channel member")
		}
		return Message{}, err
	}
	var msg Message
	err = s.db.QueryRow(ctx, `
		INSERT INTO messages (channel_id, author_id, content)
		VALUES ($1, $2, $3)
		RETURNING id, channel_id, author_id, (SELECT username FROM users WHERE id = $2), content, created_at
	`, channelID, authorID, content).Scan(&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Username, &msg.Content, &msg.CreatedAt)
	return msg, err
}

func (s *Store) ListMessages(ctx context.Context, channelID, userID string, limit int) ([]Message, error) {
	ok, err := s.IsChannelMember(ctx, channelID, userID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a channel member")
		}
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.Query(ctx, `
		SELECT m.id, m.channel_id, m.author_id, u.username, m.content, m.created_at
		FROM messages m
		JOIN users u ON u.id = m.author_id
		WHERE m.channel_id = $1
		ORDER BY m.created_at DESC
		LIMIT $2
	`, channelID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reversed := make([]Message, 0, limit)
	for rows.Next() {
		var msg Message
		if err := rows.Scan(&msg.ID, &msg.ChannelID, &msg.AuthorID, &msg.Username, &msg.Content, &msg.CreatedAt); err != nil {
			return nil, err
		}
		reversed = append(reversed, msg)
	}
	for i, j := 0, len(reversed)-1; i < j; i, j = i+1, j-1 {
		reversed[i], reversed[j] = reversed[j], reversed[i]
	}
	return reversed, rows.Err()
}

func (s *Store) ListMembers(ctx context.Context, serverID, userID string) ([]Member, error) {
	ok, err := s.IsServerMember(ctx, serverID, userID)
	if err != nil || !ok {
		if err == nil {
			err = errors.New("not a server member")
		}
		return nil, err
	}
	rows, err := s.db.Query(ctx, `
		SELECT u.id, u.username, u.avatar_url, u.status, sm.role
		FROM server_members sm
		JOIN users u ON u.id = sm.user_id
		WHERE sm.server_id = $1
		ORDER BY sm.role DESC, u.username
	`, serverID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	members := make([]Member, 0)
	for rows.Next() {
		var member Member
		if err := rows.Scan(&member.ID, &member.Username, &member.AvatarURL, &member.Status, &member.Role); err != nil {
			return nil, err
		}
		members = append(members, member)
	}
	return members, rows.Err()
}

func (s *Store) RemoveServerMember(ctx context.Context, serverID, actorID, targetID string) error {
	var actorRole string
	if err := s.db.QueryRow(ctx, `SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, serverID, actorID).Scan(&actorRole); err != nil {
		return err
	}
	if actorID != targetID && actorRole != "owner" {
		return errors.New("only owner can remove other members")
	}
	var targetRole string
	if err := s.db.QueryRow(ctx, `SELECT role FROM server_members WHERE server_id = $1 AND user_id = $2`, serverID, targetID).Scan(&targetRole); err != nil {
		return err
	}
	if targetRole == "owner" {
		return errors.New("owner cannot be removed")
	}
	_, err := s.db.Exec(ctx, `DELETE FROM server_members WHERE server_id = $1 AND user_id = $2`, serverID, targetID)
	return err
}

func (s *Store) ListAdminUsers(ctx context.Context) ([]AdminUser, error) {
	rows, err := s.db.Query(ctx, `
		SELECT u.id, u.username, u.email, u.role, COUNT(sm.server_id)::int, u.created_at
		FROM users u
		LEFT JOIN server_members sm ON sm.user_id = u.id
		GROUP BY u.id
		ORDER BY u.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := make([]AdminUser, 0)
	for rows.Next() {
		var user AdminUser
		if err := rows.Scan(&user.ID, &user.Username, &user.Email, &user.Role, &user.ServerCount, &user.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

func (s *Store) ListAdminServers(ctx context.Context) ([]AdminServer, error) {
	rows, err := s.db.Query(ctx, `
		SELECT s.id, s.name, s.owner_id, u.username,
			COUNT(DISTINCT sm.user_id)::int,
			COUNT(DISTINCT c.id)::int,
			s.created_at
		FROM servers s
		JOIN users u ON u.id = s.owner_id
		LEFT JOIN server_members sm ON sm.server_id = s.id
		LEFT JOIN channels c ON c.server_id = s.id
		GROUP BY s.id, u.username
		ORDER BY s.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	servers := make([]AdminServer, 0)
	for rows.Next() {
		var server AdminServer
		if err := rows.Scan(&server.ID, &server.Name, &server.OwnerID, &server.OwnerName, &server.MemberCount, &server.ChannelCount, &server.CreatedAt); err != nil {
			return nil, err
		}
		servers = append(servers, server)
	}
	return servers, rows.Err()
}

func (s *Store) ListAdminChannels(ctx context.Context) ([]AdminChannel, error) {
	rows, err := s.db.Query(ctx, `
		SELECT c.id, c.server_id, s.name, c.name, c.kind, c.created_at
		FROM channels c
		JOIN servers s ON s.id = c.server_id
		ORDER BY s.created_at DESC, c.position
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	channels := make([]AdminChannel, 0)
	for rows.Next() {
		var channel AdminChannel
		if err := rows.Scan(&channel.ID, &channel.ServerID, &channel.ServerName, &channel.Name, &channel.Kind, &channel.CreatedAt); err != nil {
			return nil, err
		}
		channels = append(channels, channel)
	}
	return channels, rows.Err()
}

func (s *Store) DeleteChannelAsAdmin(ctx context.Context, channelID string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM channels WHERE id = $1`, channelID)
	return err
}

func inviteCode() (string, error) {
	bytes := make([]byte, 8)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(bytes), "="), nil
}
