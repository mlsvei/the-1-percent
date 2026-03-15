import dotenv from 'dotenv';

dotenv.config();

function readEnv(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function readOptionalEnv(key: string, fallback?: string): string {
  return process.env[key] ?? fallback ?? '';
}

function readBoolEnv(key: string, fallback: boolean): boolean {
  const raw = readOptionalEnv(key);
  if (!raw) return fallback;

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function readNumberEnv(key: string, fallback: number): number {
  const raw = readOptionalEnv(key);
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readCsvLowercase(key: string): string[] {
  const raw = readOptionalEnv(key);
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  port: Number(readEnv('PORT', '4000')),
  host: readOptionalEnv('HOST', '0.0.0.0'),
  databaseUrl: readOptionalEnv('DATABASE_URL', 'memory://local'),
  creatorEmails: readCsvLowercase('APP_CREATOR_EMAILS'),
  sportsDataIo: {
    // Supports both providers. Prefer SportsDataAPI key if present.
    apiKey: readOptionalEnv('SPORTSDATAAPI_KEY', readOptionalEnv('SPORTSDATAIO_API_KEY')),
    nflSchedulesUrlTemplate: readOptionalEnv(
      'SPORTSDATAAPI_NFL_GAMES_URL_TEMPLATE',
      readOptionalEnv(
        'SPORTSDATAIO_NFL_SCHEDULES_URL_TEMPLATE',
        'https://api.sportsdata.io/v3/nfl/scores/json/Schedules/{season}'
      )
    ),
    nbaGamesByDateUrlTemplate: readOptionalEnv(
      'SPORTSDATAAPI_NBA_GAMES_BY_DATE_URL_TEMPLATE',
      readOptionalEnv(
        'SPORTSDATAIO_NBA_GAMES_BY_DATE_URL_TEMPLATE',
        'https://api.sportsdata.io/v3/nba/scores/json/GamesByDate/{date}'
      )
    ),
    cbbGamesByDateUrlTemplate: readOptionalEnv(
      'SPORTSDATAAPI_CBB_GAMES_BY_DATE_URL_TEMPLATE',
      readOptionalEnv(
        'SPORTSDATAIO_CBB_GAMES_BY_DATE_URL_TEMPLATE',
        'https://api.sportsdata.io/v3/cbb/scores/json/GamesByDate/{date}'
      )
    ),
    nhlGamesByDateUrlTemplate: readOptionalEnv(
      'SPORTSDATAAPI_NHL_GAMES_BY_DATE_URL_TEMPLATE',
      readOptionalEnv(
        'SPORTSDATAIO_NHL_GAMES_BY_DATE_URL_TEMPLATE',
        'https://api.sportsdata.io/v3/nhl/scores/json/GamesByDate/{date}'
      )
    ),
    soccerGamesByDateUrlTemplate: readOptionalEnv(
      'SPORTSDATAAPI_SOCCER_GAMES_BY_DATE_URL_TEMPLATE',
      readOptionalEnv(
        'SPORTSDATAIO_SOCCER_GAMES_BY_DATE_URL_TEMPLATE',
        'https://api.sportsdata.io/v4/soccer/scores/json/GamesByDate/{date}'
      )
    )
  },
  ingest: {
    enabled: readBoolEnv('INGEST_ENABLED', true),
    intervalSeconds: readNumberEnv('INGEST_INTERVAL_SECONDS', 30),
    includeBracketAutoIngest: readBoolEnv('INGEST_INCLUDE_BRACKET_AUTO', false)
  }
};
