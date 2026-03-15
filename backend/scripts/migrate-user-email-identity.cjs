const fs = require('fs');
const { Client } = require('pg');

const oldEmail = (process.argv[2] || '').trim().toLowerCase();
const newEmail = (process.argv[3] || '').trim().toLowerCase();

if (!oldEmail || !newEmail) {
  console.error('Usage: node scripts/migrate-user-email-identity.cjs <oldEmail> <newEmail>');
  process.exit(1);
}

function readDatabaseUrl() {
  const env = fs.readFileSync('/Applications/Codex stuff/backend/.env', 'utf8');
  const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL not found in backend/.env');
  return line.slice('DATABASE_URL='.length).trim();
}

(async () => {
  const client = new Client({ connectionString: readDatabaseUrl() });
  await client.connect();

  const users = await client.query(
    `select id, lower(email) as email
     from users
     where lower(email) in ($1, $2)
     order by email asc`,
    [oldEmail, newEmail]
  );

  const oldUser = users.rows.find((u) => u.email === oldEmail);
  const newUser = users.rows.find((u) => u.email === newEmail);

  if (!oldUser) throw new Error(`Old user not found: ${oldEmail}`);
  if (!newUser) throw new Error(`New user not found: ${newEmail}`);

  const oldId = oldUser.id;
  const newId = newUser.id;

  const before = await client.query(
    `select user_id, count(*)::int as count
     from entries
     where user_id in ($1, $2)
     group by user_id
     order by user_id`,
    [oldId, newId]
  );

  await client.query('begin');
  try {
    await client.query('delete from group_members where user_id = $1 and group_id in (select group_id from group_members where user_id = $2)', [oldId, newId]);
    await client.query('update group_members set user_id = $1 where user_id = $2', [newId, oldId]);

    await client.query('delete from entries where user_id = $1 and contest_id in (select contest_id from entries where user_id = $2)', [oldId, newId]);
    await client.query('update entries set user_id = $1 where user_id = $2', [newId, oldId]);

    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  }

  const after = await client.query(
    `select user_id, count(*)::int as count
     from entries
     where user_id in ($1, $2)
     group by user_id
     order by user_id`,
    [oldId, newId]
  );

  console.log(
    JSON.stringify(
      {
        oldEmail,
        newEmail,
        oldUserId: oldId,
        newUserId: newId,
        entriesBefore: before.rows,
        entriesAfter: after.rows
      },
      null,
      2
    )
  );

  await client.end();
})().catch((err) => {
  console.error(err?.stack || String(err));
  process.exit(1);
});
