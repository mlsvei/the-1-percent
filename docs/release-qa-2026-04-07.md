# Release QA - 2026-04-07

## Scope
- March Madness bracket advancement labels
- March Madness downstream pick invalidation
- March Madness long-name bracket layout
- Bracket auto-clear status messaging
- Entry auto-resolution before save flows
- Session expiry and logout cleanup
- Admin gating and draft contest visibility
- Authenticated leaderboard loading

## Fix Summary
- Resolved March Madness winner placeholders through chained prior picks so later-round labels show the picked team.
- Pruned invalid downstream March Madness picks after upstream changes, including multi-round cascades.
- Increased March bracket spacing and constrained long selected labels so connector lines do not overlap adjacent rounds.
- Added status feedback when downstream bracket picks are auto-cleared.
- Centralized contest entry resolution so save flows load or create the correct entry before submitting.
- Added centralized `401` handling so expired sessions log out cleanly and clear stale contest/admin state.
- Removed hardcoded frontend creator-email gating in favor of protected admin endpoint detection.
- Hid draft contests from the public contests endpoint.
- Fixed leaderboard and group loads to use the auth token rather than the user ID.
- Removed the duplicate nested workspace copy at `/Applications/Codex stuff/Codex stuff`.

## QA Completed
- March Madness advancement labels update correctly after picks.
- March Madness downstream picks clear correctly after upstream winner changes.
- Multi-round invalidation cascades through Elite 8, Final Four, and Championship.
- Long team names render without connector overlap, both selected and unselected.
- Auto-clear status messages show correct singular and plural counts.
- Saved picks persist after refresh.
- Entry creation/resolution works when saving without manually creating an entry first.
- `Create Entry` shows `Entry ready.` when an entry already exists.
- Session-expiry handling logs the user out cleanly and clears stale state.
- Non-admin users do not see draft contests.
- Non-admin users do not see admin-only controls.
- Admin visibility returns correctly after logging back in as admin.
- Contest leaderboard entries load correctly after saving picks.

## Residual Risk
- Olympic and UEFA bracket flows were not revalidated end-to-end because those contests were locked.
- Direct API admin-route probing was skipped after UI/admin gating was validated.

## Deploy Notes
- Frontend changes deployed via Vercel from `/Applications/Codex stuff/frontend`.
- Backend changes deployed via Render from `/Applications/Codex stuff/backend`.
