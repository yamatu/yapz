# Yapz Database Design

## Tables

- `users`: login identity, profile, status.
- `servers`: community containers owned by users.
- `server_members`: membership and simple role.
- `channels`: text or voice rooms within servers.
- `messages`: persisted text messages.
- `voice_sessions`: durable model for voice presence expansion.

## Relationships

- A user owns many servers.
- A server has many members.
- A server has many channels.
- A text channel has many messages.
- A voice channel can have many active voice sessions.

## V1 Permission Model

- `owner`: created the server.
- `member`: belongs to the server.

All server members can see all channels in V1.
