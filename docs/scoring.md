# Scoring and Instant Grading

## Pick'em (NFL)
- Base points: 1 point per correct winner pick.
- Optional confidence mode: users assign unique confidence points (1..N) each week; awarded points equal confidence for correct picks.
- Lock: each pick locks at game kickoff.

## Bracket (March Madness)
- Typical escalating model:
  - Round of 64: 1
  - Round of 32: 2
  - Sweet 16: 4
  - Elite 8: 8
  - Final Four: 16
  - Championship: 32
- Optional upset bonus: +seed difference cap.
- Lock: entire bracket at first tournament tipoff (MVP default).

## Grading Engine Pattern
1. Receive game status update (`in_progress`, `final`, correction).
2. Resolve affected contest + entries.
3. Recompute only impacted picks/bracket slots.
4. Emit immutable `score_events` for deltas.
5. Update `entries.total_points` transactionally.
6. Refresh leaderboard snapshot cache.

## Idempotency
- Use `(provider, provider_game_id, update_seq)` idempotency key.
- Ignore duplicate updates.
- Allow correction events by replaying from event log for a contest.

## Real-Time UX
- Push leaderboard updates through WebSockets/SSE.
- Fallback polling every 15-30s.
