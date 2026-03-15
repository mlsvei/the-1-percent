# Backend API

This backend powers contests, entries, groups, ingest, and grading.

## Core routes
- Auth: `/api/auth/dev-login`, `/api/auth/me`
- Users: `/api/users`
- Groups: `/api/groups`
- Contests: `/api/contests`
- Entries: `/api/contests/:contestId/entries`
- Picks: `/api/contests/:contestId/picks`
- Brackets: `/api/contests/:contestId/bracket-picks`
- Health:
  - `/api/health`
  - `/api/health/db`
  - `/api/health/worker`

## Local development
1. Install Node.js 20+ and npm.
2. Create a PostgreSQL database.
3. Copy env file:
   - `cp .env.example .env`
4. Install dependencies:
   - `npm install`
5. Bootstrap DB schema:
   - `npm run db:bootstrap`
6. Start API:
   - `npm run dev`

## Production deployment
- Docker image:
  - `/Applications/Codex stuff/backend/Dockerfile`
- Render config:
  - `/Applications/Codex stuff/render.yaml`
- Railway config:
  - `/Applications/Codex stuff/railway.json`
- Production env template:
  - `/Applications/Codex stuff/backend/.env.production.example`

Production should run behind a public API URL such as:
- `https://api.the1percent.app`

Do not rely on `localhost` or your Mac for live grading.

## Worker behavior
- Active contests auto-check every 60 seconds.
- Idle periods fall back to 300 seconds.
- Worker health is exposed at `/api/health/worker`.
- Detailed logs now show exactly which contests and game slots were synced and graded.

## Data providers
- NFL: SportsDataIO
- NBA: SportsDataIO
- NCAAB: ESPN first, SportsDataIO fallback
- NHL: SportsDataIO with NHL API fallback/enrichment
- UEFA: SportsDataIO first, ESPN fallback

## Notes
- SportsDataIO ingest sync is implemented for supported contests.
- Pick'em contests can lock per game; brackets lock at contest start.
- Manual admin regrade is available in the UI via `Run Grading Now`.
