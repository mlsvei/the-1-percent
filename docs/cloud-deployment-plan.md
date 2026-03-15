# The 1% Cloud Deployment Plan

## Target architecture
- Frontend: Vercel serving the React/Vite app
- Backend: Render or Railway serving the Node/Express API and ingest worker
- Database: Supabase Postgres
- Sports data: SportsDataIO primary, ESPN/NHL API fallbacks where already configured

## Production URLs
Use real public URLs instead of localhost:
- Frontend URL example: `https://app.the1percent.app`
- Backend URL example: `https://api.the1percent.app`
- Frontend env: `VITE_API_BASE=https://api.the1percent.app/api`

Do not keep `127.0.0.1` or `localhost` in production env files.

## Backend deploy options
### Render
- Config file: `/Applications/Codex stuff/render.yaml`
- Set secrets in Render:
  - `DATABASE_URL`
  - `SPORTSDATAIO_API_KEY`
  - `SPORTSDATAAPI_KEY`
- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Health check: `/api/health`

### Railway
- Config file: `/Applications/Codex stuff/railway.json`
- Service root: `backend`
- Set the same secrets as Render
- Health check: `/api/health`

## Frontend deploy options
### Vercel
- Project root: `frontend`
- Config file: `/Applications/Codex stuff/frontend/vercel.json`
- Set env:
  - `VITE_API_BASE=https://api.the1percent.app/api`
- Framework preset: Vite

## Docker path
### Backend image
- File: `/Applications/Codex stuff/backend/Dockerfile`
- Exposes port `4000`

### Frontend image
- File: `/Applications/Codex stuff/frontend/Dockerfile`
- Build arg:
  - `VITE_API_BASE=https://api.the1percent.app/api`
- Exposes port `8080`

### Local production-style compose
- File: `/Applications/Codex stuff/docker-compose.production.yml`
- Requires:
  - `/Applications/Codex stuff/backend/.env.production`
  - `VITE_API_BASE` exported or set in compose environment

## Recommended rollout
1. Deploy backend first on Render or Railway.
2. Confirm backend health at `/api/health` and `/api/health/db`.
3. Point frontend `VITE_API_BASE` at the live backend URL.
4. Deploy frontend on Vercel.
5. Update your DNS so users hit the public domains instead of your Mac.

## Stability notes
- The ingest/grading worker belongs on the backend service, not the frontend.
- Production should not depend on `pm2` on your Mac.
- Keep the backend on a host that runs continuously so grading keeps working when your laptop is closed.
