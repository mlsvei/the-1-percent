import { query } from '../db.js';

let streakSchemaEnsured = false;

export async function ensureStreakSchema() {
  if (streakSchemaEnsured) return;

  const constraint = await query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def
       from pg_constraint
      where conrelid = 'contests'::regclass and conname = 'contests_type_check'`
  );
  if (!constraint.rows[0]?.def.includes('STREAK')) {
    await query('alter table contests drop constraint if exists contests_type_check');
    await query(
      `alter table contests add constraint contests_type_check
         check (type in ('PICKEM_NFL','PICKEM_NBA','PICKEM_NHL','BRACKET_NCAAM','STREAK'))`
    );
  }

  await query('alter table entries add column if not exists current_streak int not null default 0');
  await query('alter table entries add column if not exists best_streak int not null default 0');

  await query(`
    create table if not exists streak_picks (
      id uuid primary key,
      entry_id uuid not null references entries(id),
      game_id uuid not null references games(id),
      picked_winner text not null,
      status text not null check (status in ('ACTIVE','WON','LOST','FORFEITED')),
      streak_before int not null,
      created_at timestamptz not null default now(),
      resolved_at timestamptz
    )
  `);
  await query(
    `create unique index if not exists streak_picks_one_active_per_entry
       on streak_picks (entry_id) where status = 'ACTIVE'`
  );

  streakSchemaEnsured = true;
}
