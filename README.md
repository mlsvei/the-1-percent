# Sports Prediction Contest App (MVP Blueprint)

This project now has:
- Backend API + ingest + grading engine
- Frontend website for normal browser use

## Folders
- `/Applications/Codex stuff/backend`
- `/Applications/Codex stuff/frontend`
- `/Applications/Codex stuff/docs`

## Quick Start
From the repository root, start the backend in one terminal:

```bash
cd backend
npm ci
PORT=4001 DATABASE_URL=memory://local INGEST_ENABLED=false \
  APP_JWT_SECRET="$(openssl rand -hex 32)" npm run dev
```

Start the frontend in a second terminal, also from the repository root:

```bash
cd frontend
npm ci
VITE_API_BASE=/api npm run dev
```

Open http://localhost:5173. Vite proxies API requests to port 4001.
Check the backend at http://localhost:4001/api/health.

The backend initializes its in-memory database on startup, and data resets
when it restarts. Run `npm run db:bootstrap` only when setting up a separate
PostgreSQL database with its own `DATABASE_URL`.

## SportsDataIO worker commands
- `npm run ingest:sync`
- `npm run ingest:watch`
- `npm run grade:run`
