import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataType, newDb } from 'pg-mem';
import { Pool, type QueryResultRow } from 'pg';
import { config } from './config.js';

function createMemoryPool(): Pool {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: 'now',
    returns: DataType.timestamptz,
    implementation: () => new Date()
  });

  const schemaPath = resolve(process.cwd(), '..', 'docs', 'schema.sql');
  const schemaSql = readFileSync(schemaPath, 'utf8');
  db.public.none(schemaSql);

  const adapter = db.adapters.createPg();
  return new adapter.Pool() as unknown as Pool;
}

const useMemory = config.databaseUrl.startsWith('memory://');
const useNoVerifySsl = /sslmode=no-verify/i.test(config.databaseUrl);
const transientErrorCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT']);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDatabaseHost(): string {
  if (useMemory) return 'memory';
  try {
    return new URL(config.databaseUrl).hostname;
  } catch {
    return 'unknown';
  }
}

function formatDbError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown error';
  const code = String((error as { code?: unknown }).code ?? '');
  const message = String((error as { message?: unknown }).message ?? 'unknown error');
  const host = String((error as { hostname?: unknown }).hostname ?? getDatabaseHost());
  return [code, message, host ? '(host=' + host + ')' : ''].filter(Boolean).join(' ');
}

function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = String((error as { code?: unknown }).code ?? '');
  const message = String((error as { message?: unknown }).message ?? '');
  return transientErrorCodes.has(code) || message.includes('Connection terminated unexpectedly');
}

export const pool = useMemory
  ? createMemoryPool()
  : new Pool({
      connectionString: config.databaseUrl,
      ssl: useNoVerifySsl ? { rejectUnauthorized: false } : undefined,
      keepAlive: true,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      statement_timeout: 0,
      query_timeout: 0
    });

pool.on('error', (error) => {
  console.error('[db] pool error:', formatDbError(error));
});

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await pool.query<T>(text, params);
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === 2) {
        throw error;
      }
      console.warn('[db] transient query failure; retry ' + (attempt + 1) + '/3: ' + formatDbError(error));
      await sleep(250 * (attempt + 1));
    }
  }

  throw new Error('Unreachable');
}

export async function dbHealthCheck() {
  const startedAt = Date.now();
  try {
    await pool.query('select 1 as ok');
    return {
      ok: true,
      host: getDatabaseHost(),
      latencyMs: Date.now() - startedAt,
      mode: useMemory ? 'memory' : 'postgres'
    };
  } catch (error) {
    return {
      ok: false,
      host: getDatabaseHost(),
      latencyMs: Date.now() - startedAt,
      mode: useMemory ? 'memory' : 'postgres',
      error: formatDbError(error)
    };
  }
}
