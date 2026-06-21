# Yapz Project Summary

## Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS.
- Backend: Go, PostgreSQL, pgx, JWT, bcrypt, gorilla/websocket.
- Database: PostgreSQL 16.

## Implemented V1 Foundation

- Auth UI and API.
- Server creation with default channels.
- Channel listing and creation.
- Member listing.
- Persisted text messages.
- WebSocket channel subscription and message broadcast.
- Voice channel presence controls and signaling channel.
- Invite code flow for joining a friend's server.
- Personal center password change screen.
- Admin console for all users, servers, and channels.
- shadcn-style local UI primitives for buttons, cards, inputs, labels, and badges.
- Server owners can remove members; members can leave servers themselves.
- Voice channels now use browser WebRTC microphone audio with DTLS-SRTP encrypted media transport.
- Auth bootstrap now shows a loading state instead of flashing the login screen while restoring a saved token.

## Next Milestones

1. Add real WebRTC microphone audio.
2. Add invite links for joining servers.
3. Add profile settings and avatar upload.
4. Add mobile drawer layout.
5. Add automated backend integration tests.
