# Yapz API Design

## Auth

- `POST /api/auth/register`
  - Body: `username`, `email`, `password`
  - Returns: `token`, `user`
- `POST /api/auth/login`
  - Body: `login`, `password`
  - Returns: `token`, `user`
- `GET /api/me`
  - Auth: Bearer token
  - Returns current user.

## Servers

- `GET /api/servers`
- `POST /api/servers`
  - Body: `name`, `description`, `iconText`
  - Creates default text and voice channels.
- `GET /api/servers/{serverID}/invite`
  - Creates or returns the server invite code.
- `POST /api/invites/join`
  - Body: `code`
  - Adds the current user to the invited server.

## Channels

- `GET /api/servers/{serverID}/channels`
- `POST /api/servers/{serverID}/channels`
  - Body: `name`, `kind`
  - `kind` is `text` or `voice`.

## Members

- `GET /api/servers/{serverID}/members`
- `DELETE /api/servers/{serverID}/members/{memberID}`
  - Server owner can remove members.
  - A member can remove themselves to leave the server.

## Account

- `POST /api/me/password`
  - Body: `currentPassword`, `nextPassword`
  - Changes the current user's password.

## Messages

- `GET /api/channels/{channelID}/messages?limit=80`
- `POST /api/channels/{channelID}/messages`
  - Body: `content`

## WebSocket

- `GET /ws?token=JWT`

Client messages:

- `join_channel`
- `typing`
- `voice_join`
- `voice_leave`
- `voice_signal`

Voice media is browser-to-browser WebRTC audio. The backend only relays signaling messages; media is encrypted by WebRTC DTLS-SRTP and is not sent through the Go API.

Server messages:

- `channel_joined`
- `message_created`
- `voice_join`
- `voice_leave`
- `voice_signal`

## Admin

Admin endpoints require an authenticated user with `role = admin`.

- `GET /api/admin/users`
- `GET /api/admin/servers`
- `GET /api/admin/channels`
- `DELETE /api/admin/channels/{channelID}`
