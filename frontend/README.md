# Frontend Website

This is the browser UI for The 1%.

## Production-first configuration
- Default API base should be your live backend URL, not localhost.
- Example production env:
  - `VITE_API_BASE=https://api.the1percent.app/api`
- Dedicated production template:
  - `/Applications/Codex stuff/frontend/.env.production.example`

## Local development
1. Start backend in one terminal:
   - `cd "/Applications/Codex stuff/backend"`
   - `npm install`
   - `cp .env.example .env`
   - `npm run db:bootstrap`
   - `npm run dev`
2. Start frontend in another terminal:
   - `cd "/Applications/Codex stuff/frontend"`
   - `npm install`
   - set `VITE_API_BASE=http://127.0.0.1:4001/api` in `.env.development` or `.env`
   - `npm run dev`
3. Open:
   - `http://127.0.0.1:5174`

## Deployment
- Vercel config:
  - `/Applications/Codex stuff/frontend/vercel.json`
- Docker image:
  - `/Applications/Codex stuff/frontend/Dockerfile`
- Build arg for Docker:
  - `VITE_API_BASE=https://api.the1percent.app/api`

## Notes
- Uses dev-header auth flow from the backend (`x-user-id`).
- For production, the frontend must point at a continuously running backend, not your Mac.
