import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  const schemaPath = resolve(process.cwd(), '..', 'docs', 'schema.sql');
  const sql = await readFile(schemaPath, 'utf8');

  await pool.query('create extension if not exists pgcrypto;');
  await pool.query(sql);

  console.log('Database bootstrap complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
