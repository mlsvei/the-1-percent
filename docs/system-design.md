# System Design

## Core Domains
- User: account, profile, timezone
- Group: public/private, membership, roles
- Contest: type (`PICKEM_NFL`, `BRACKET_NCAAM`), season, lock windows
- Entry: a user's submission in a contest
- Pick: game-level picks for pick'em
- Bracket: tree picks for March Madness
- GameResult: canonical final game data from provider
- ScoreEvent: immutable grading events
- LeaderboardSnapshot: rank cache per contest/group

## Services
- API service: auth, CRUD, joins, submissions
- Ingest service: pulls schedules/results from provider APIs
- Grading service: computes points and emits score events
- Leaderboard service: computes ranks, ties, and caches top N

## Data Flow
1. Ingest service imports schedules and creates internal `games`.
2. Users submit picks/brackets before lock time.
3. Provider posts updates or polling detects score/final state changes.
4. Grading service recalculates impacted entries only.
5. Leaderboard snapshot updates instantly (contest + group views).

## Locking Rules
- Pick'em: lock each game at kickoff.
- Bracket: lock first game tipoff for full bracket (or round-based lock if desired).

## Leaderboard Rules
- Sort by total points desc.
- Tie-breakers: exact score predictions, then earliest submission time.
- Separate views for global contest leaderboard and each group leaderboard.

## Non-Functional Requirements
- Idempotent ingest and grading.
- All grading operations auditable (event log).
- Retries with dead-letter queue for failed provider fetches.
- Soft-delete user data and support account export.
