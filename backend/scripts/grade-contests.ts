import dotenv from 'dotenv';
import { pool } from '../src/db.js';
import { gradeContests } from '../src/services/grading.js';

dotenv.config();

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main() {
  const contestId = readArg('contestId');
  const results = await gradeContests({ contestIds: contestId ? [contestId] : undefined, source: 'MANUAL' });

  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
