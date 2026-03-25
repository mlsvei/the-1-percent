import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import { ensureAuthTables, hashPassword, issueAuthToken, verifyPassword } from '../services/auth.js';
import type { AuthenticatedRequest } from '../types.js';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  timezone: z.string().default('America/New_York')
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const devLoginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1),
  timezone: z.string().default('America/New_York')
});

type UserRow = {
  id: string;
  email: string;
  displayName: string;
  timezone: string;
  createdAt: string;
  passwordHash?: string | null;
};

async function loadUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  const result = await query<UserRow>(
    `select u.id,
            u.email,
            u.display_name as "displayName",
            u.timezone,
            u.created_at as "createdAt",
            uc.password_hash as "passwordHash"
     from users u
     left join user_credentials uc on uc.user_id = u.id
     where lower(u.email) = $1
     limit 1`,
    [normalized]
  );
  return result.rows[0] ?? null;
}

function authResponse(user: UserRow) {
  return {
    token: issueAuthToken({ id: user.id, email: user.email }),
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      timezone: user.timezone,
      createdAt: user.createdAt
    }
  };
}

authRouter.post('/auth/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await ensureAuthTables();

  const email = parsed.data.email.trim().toLowerCase();
  const passwordHash = hashPassword(parsed.data.password);
  const existing = await loadUserByEmail(email);

  if (existing?.passwordHash) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }

  let user: UserRow;
  if (existing) {
    await query(
      'update users set display_name = $2, timezone = $3 where id = $1',
      [existing.id, parsed.data.displayName, parsed.data.timezone]
    );
    await query(
      'insert into user_credentials (user_id, password_hash) values ($1, $2) on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()',
      [existing.id, passwordHash]
    );
    user = {
      ...existing,
      displayName: parsed.data.displayName,
      timezone: parsed.data.timezone,
      passwordHash
    };
  } else {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await query(
      'insert into users (id, email, display_name, timezone, created_at) values ($1, $2, $3, $4, $5)',
      [id, email, parsed.data.displayName, parsed.data.timezone, createdAt]
    );
    await query('insert into user_credentials (user_id, password_hash) values ($1, $2)', [id, passwordHash]);
    user = {
      id,
      email,
      displayName: parsed.data.displayName,
      timezone: parsed.data.timezone,
      createdAt,
      passwordHash
    };
  }

  res.status(201).json(authResponse(user));
});

authRouter.post('/auth/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  await ensureAuthTables();

  const user = await loadUserByEmail(parsed.data.email);
  if (!user?.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  res.json(authResponse(user));
});

authRouter.post('/auth/dev-login', async (req, res) => {
  if (config.nodeEnv === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const parsed = devLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { email, displayName, timezone } = parsed.data;
  const existing = await query<UserRow>(
    'select id, email, display_name as "displayName", timezone, created_at as "createdAt" from users where email = $1 limit 1',
    [email.trim().toLowerCase()]
  );

  let user = existing.rows[0];
  if (!user) {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    await query('insert into users (id, email, display_name, timezone, created_at) values ($1, $2, $3, $4, $5)', [id, email.trim().toLowerCase(), displayName, timezone, createdAt]);
    user = { id, email: email.trim().toLowerCase(), displayName, timezone, createdAt };
  } else {
    await query('update users set display_name = $2, timezone = $3 where id = $1', [user.id, displayName, timezone]);
    user = { ...user, displayName, timezone };
  }

  res.json(authResponse(user));
});

authRouter.get('/auth/me', requireUser, async (req: AuthenticatedRequest, res) => {
  const result = await query(
    'select id, email, display_name as "displayName", timezone, created_at as "createdAt" from users where id = $1',
    [req.userId]
  );

  if (!result.rows[0]) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json(result.rows[0]);
});
