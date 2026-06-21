# Yapz Project Prompts

## Continue Frontend

Implement the next Yapz frontend feature using the existing Next.js App Router and Tailwind style. Keep the app workspace as the first authenticated screen. Use lucide-react icons for controls and avoid landing-page patterns.

## Continue Backend

Implement the next Yapz backend feature using the existing Go `net/http`, pgx, JWT, and WebSocket structure. Keep REST for resource APIs and WebSocket for realtime channel events.

## Add WebRTC Voice

Extend the existing voice channel flow so browsers exchange WebRTC offers, answers, and ICE candidates through the current `voice_signal` WebSocket message type. Add frontend peer connection lifecycle handling, microphone permission states, and cleanup on channel leave.

## Add Roles

Extend the database and API with server roles and channel permissions. Preserve the V1 owner/member behavior as the default migration path.
