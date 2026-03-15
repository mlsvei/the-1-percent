# Sports Prediction Contest App (MVP Blueprint)

This project now has:
- Backend API + ingest + grading engine
- Frontend website for normal browser use

## Folders
- `/Applications/Codex stuff/backend`
- `/Applications/Codex stuff/frontend`
- `/Applications/Codex stuff/docs`

## Quick Start
1. Backend:
   - `cd "/Applications/Codex stuff/backend"`
   - `npm install`
   - `cp .env.example .env`
   - `npm run db:bootstrap`
   - `npm run dev`
2. Frontend:
   - `cd "/Applications/Codex stuff/frontend"`
   - `npm install`
   - `cp .env.example .env`
   - `npm run dev`
3. Open website:
   - `http://localhost:5173`

## SportsDataIO worker commands
- `npm run ingest:sync`
- `npm run ingest:watch`
- `npm run grade:run`
