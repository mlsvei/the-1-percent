# CBB Spot Backtest

This script backtests college basketball ATS spot factors and searches for optimized factor combinations.

## Script
- `/Applications/Codex stuff/backend/scripts/cbb-spot-backtest.ts`

## Input CSV format
- Team-game format: one row per team per game.
- Required columns:
  - `date` (YYYY-MM-DD)
  - `season` (e.g. `2024-25`)
  - `team`
  - `opponent`
  - `is_home` (1=home, 0=away)
  - `team_score`
  - `opp_score`
  - `spread` (from the listed team's perspective; favorite is negative)

Template:
- `/Applications/Codex stuff/backend/scripts/data/cbb_team_games_template.csv`

## Spot factors included
- `away_revenge`
- `home_lookahead`
- `home_letdown`
- `opp_road_fatigue`
- `rest_diff`
- `team_games_last7`
- `opp_games_last7`
- `z_model_edge` (difference between sportsbook spread and simple fair spread model)

## Run
From backend folder:

```bash
cd "/Applications/Codex stuff/backend"
npx tsx scripts/cbb-spot-backtest.ts --input ./scripts/data/cbb_team_games.csv --split 0.7 --iters 10000 --min-bets 200
```

## Notes
- The script uses chronological train/test split to avoid leakage.
- Candidate strategies are filtered by minimum bet count.
- The result may or may not hit 57% ATS out of sample; script reports true holdout result.
