# SportsDataIO Source Notes

Use official SportsDataIO docs for your licensed endpoints and sport package.

Default templates in this project are:
- NFL schedules: `https://api.sportsdata.io/v3/nfl/scores/json/Schedules/{season}`
- NCAA men's games by date: `https://api.sportsdata.io/v3/cbb/scores/json/GamesByDate/{date}`

If your package uses different paths/versions, override with env vars:
- `SPORTSDATAIO_NFL_SCHEDULES_URL_TEMPLATE`
- `SPORTSDATAIO_CBB_GAMES_BY_DATE_URL_TEMPLATE`
