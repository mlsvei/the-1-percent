import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db.js';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  createdAt?: string;
};

type AuthTokenPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

let warnedFallbackSecret = false;

function authSecret(): string {
  if (config.jwt.secret) return config.jwt.secret;

  if (!warnedFallbackSecret) {
    warnedFallbackSecret = true;
    console.warn('[auth] APP_JWT_SECRET not set; deriving JWT secret from DATABASE_URL. Set APP_JWT_SECRET explicitly in production.');
  }

  return createHash('sha256').update(`${config.databaseUrl}|the1-jwt`).digest('hex');
}

function encodeBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function signHmac(input: string): string {
  return createHmac('sha256', authSecret()).update(input).digest('base64url');
}

export function issueAuthToken(user: Pick<AuthUser, 'id' | 'email'>): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: AuthTokenPayload = {
    sub: user.id,
    email: user.email,
    iat: now,
    exp: now + config.jwt.tokenTtlHours * 60 * 60
  };

  const header = encodeBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = encodeBase64Url(JSON.stringify(payload));
  const signature = signHmac(`${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format');
  }

  const [header, body, signature] = parts;
  const expected = signHmac(`${header}.${body}`);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    throw new Error('Invalid token signature');
  }

  const payload = JSON.parse(decodeBase64Url(body)) as AuthTokenPayload;
  if (!payload.sub || !payload.email || !payload.exp) {
    throw new Error('Invalid token payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new Error('Token expired');
  }

  return payload;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;

  const actualHash = scryptSync(password, salt, 64).toString('hex');
  const actualBuf = Buffer.from(actualHash, 'hex');
  const expectedBuf = Buffer.from(expectedHash, 'hex');
  return actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf);
}

export async function ensureAuthTables() {
  await query(`
    create table if not exists user_credentials (
      user_id uuid primary key references users(id) on delete cascade,
      password_hash text not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}
