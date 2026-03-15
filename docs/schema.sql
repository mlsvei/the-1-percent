-- PostgreSQL MVP schema

create table users (
  id uuid primary key,
  email text unique not null,
  display_name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table groups (
  id uuid primary key,
  owner_user_id uuid not null references users(id),
  name text not null,
  visibility text not null check (visibility in ('PUBLIC', 'PRIVATE')),
  join_code text unique,
  created_at timestamptz not null default now()
);

create table group_members (
  group_id uuid not null references groups(id),
  user_id uuid not null references users(id),
  role text not null check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table contests (
  id uuid primary key,
  name text not null,
  type text not null check (type in ('PICKEM_NFL', 'PICKEM_NBA', 'PICKEM_NHL', 'BRACKET_NCAAM')),
  season int not null,
  starts_at timestamptz not null,
  lock_mode text not null check (lock_mode in ('PER_GAME', 'FULL_BRACKET', 'PER_ROUND')),
  scoring_config jsonb not null,
  status text not null check (status in ('DRAFT', 'OPEN', 'LOCKED', 'COMPLETE')),
  created_at timestamptz not null default now()
);

create table group_contests (
  group_id uuid not null references groups(id),
  contest_id uuid not null references contests(id),
  primary key (group_id, contest_id)
);

create table games (
  id uuid primary key,
  contest_id uuid not null references contests(id),
  provider_game_id text not null,
  sport text not null,
  home_team text not null,
  away_team text not null,
  start_time timestamptz not null,
  status text not null,
  home_score int,
  away_score int,
  winner text,
  unique (contest_id, provider_game_id)
);

create table entries (
  id uuid primary key,
  contest_id uuid not null references contests(id),
  user_id uuid not null references users(id),
  submitted_at timestamptz,
  total_points int not null default 0,
  unique (contest_id, user_id)
);

create table picks (
  id uuid primary key,
  entry_id uuid not null references entries(id),
  game_id uuid not null references games(id),
  picked_winner text not null,
  confidence_points int,
  locked_at timestamptz,
  is_correct boolean,
  points_awarded int not null default 0,
  unique (entry_id, game_id)
);

create table bracket_picks (
  id uuid primary key,
  entry_id uuid not null references entries(id),
  game_slot text not null,
  picked_team text not null,
  round int not null,
  is_correct boolean,
  points_awarded int not null default 0,
  unique (entry_id, game_slot)
);

create table score_events (
  id uuid primary key,
  contest_id uuid not null references contests(id),
  entry_id uuid not null references entries(id),
  source text not null,
  event_type text not null,
  delta int not null,
  metadata jsonb not null,
  created_at timestamptz not null default now()
);

create table leaderboard_snapshots (
  id uuid primary key,
  contest_id uuid not null references contests(id),
  group_id uuid references groups(id),
  computed_at timestamptz not null default now(),
  payload jsonb not null
);
