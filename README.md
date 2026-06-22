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
- Garage S3 API: `http://localhost:3900`
- Garage admin API: `http://localhost:3903`
- Uploaded images: stored in Garage bucket `yapz-images` and served through backend `/uploads/`

Default admin account:

- Email: `admin@yapz.local`
- Password: `Admin123456`

The backend seeds this account on startup only when it does not already exist. Override `ADMIN_EMAIL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` in `docker-compose.yml` or your deployment environment before the first startup to configure your own administrator account. After the account exists, change its password from the personal center.

Production login and uploads use same-origin `/api`, `/ws`, and `/uploads` paths. Make sure Nginx proxies `/api/`, `/ws`, and `/uploads/` to the backend on `127.0.0.1:8080`; otherwise login/register, realtime voice, or uploaded images will fail. Do not run `docker compose down -v` in production unless you intentionally want to delete the PostgreSQL volume, Garage volumes, local upload fallback volume, and all registered accounts.

## Garage Object Storage

Docker Compose starts a single-node Garage service with a default S3-compatible bucket:

- Bucket: `yapz-images`
- Endpoint inside Docker: `http://garage:3900`
- Local S3 endpoint: `http://localhost:3900`
- Access key: `GKYAPZLOCALDEV0000000000000000`
- Secret key: `yapz-local-dev-secret-change-me-000000000000000000000000`

Change these values in `docker-compose.yml` before production use. The backend still serves images through `/uploads/images/{file}` so the browser never needs S3 credentials.

## Default Environment

Backend defaults:

- `PORT=8080`
- `DATABASE_URL=postgres://yapz:yapz@localhost:5432/yapz?sslmode=disable`
- `JWT_SECRET=dev-change-me`
- `CORS_ORIGIN=http://localhost:3000`
- `ADMIN_EMAIL=admin@yapz.local`
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD=Admin123456`
- `UPLOAD_DIR=uploads`
- `STORAGE_DRIVER=local`
- `S3_ENDPOINT=`
- `S3_REGION=garage`
- `S3_BUCKET=yapz-images`
- `S3_ACCESS_KEY_ID=`
- `S3_SECRET_ACCESS_KEY=`

Frontend defaults:

- `NEXT_PUBLIC_API_URL` is optional. When omitted, the frontend uses same-origin `/api`, `/ws`, and `/uploads` paths.
