# Yapz

Yapz is a web game channel chat platform built with Next.js, Go, and PostgreSQL. It supports password login, servers, text channels, voice-channel presence, realtime messages, and WebSocket voice signaling.

## Local Development

1. Start PostgreSQL:

```powershell
docker compose up -d postgres
```

2. Start the backend:

```powershell
cd backend
go run ./cmd/api
```

3. Start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Docker Compose

Run the full stack:

```powershell
docker compose up -d --build
```

Services:

- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8080`
- PostgreSQL: `localhost:5432`

Default admin account:

- Email: `admin@yapz.local`
- Password: `Admin123456`

The backend seeds this account on startup only when it does not already exist. Override `ADMIN_EMAIL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in `docker-compose.yml` or your deployment environment before the first startup to configure your own administrator account. After the account exists, change its password from the personal center.

Production login uses same-origin `/api` and `/ws` paths. Make sure Nginx proxies `/api/` and `/ws` to the backend on `127.0.0.1:8080`; otherwise the frontend will show a connection error on login/register. Do not run `docker compose down -v` in production unless you intentionally want to delete the PostgreSQL volume and all registered accounts.

## Default Environment

Backend defaults:

- `PORT=8080`
- `DATABASE_URL=postgres://yapz:yapz@localhost:5432/yapz?sslmode=disable`
- `JWT_SECRET=dev-change-me`
- `CORS_ORIGIN=http://localhost:3000`
- `ADMIN_EMAIL=admin@yapz.local`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=Admin123456`

Frontend defaults:

- `NEXT_PUBLIC_API_URL=http://localhost:8080`
