import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { requireUser } from '../middleware/require-user.js';
import type { AuthenticatedRequest } from '../types.js';

export const groupsRouter = Router();

const uuidSchema = z.string().uuid();

const createGroupSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string().trim().min(2),
  visibility: z.enum(['PUBLIC', 'PRIVATE']),
  password: z.string().trim().optional()
}).superRefine((value, ctx) => {
  if (value.visibility === 'PRIVATE' && (!value.password || value.password.length < 4)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['password'],
      message: 'Private groups require a password with at least 4 characters'
    });
  }
});

const joinGroupSchema = z.object({
  contestId: z.string().uuid(),
  joinCode: z.string().optional()
});

const joinPrivateGroupSchema = z.object({
  contestId: z.string().uuid(),
  name: z.string().trim().min(2),
  password: z.string().trim().min(1)
});

groupsRouter.post('/groups', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = createGroupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [parsed.data.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const existingByName = await query<{ id: string }>(
    `select g.id
       from groups g
       join group_contests gc on gc.group_id = g.id
      where gc.contest_id = $1 and lower(g.name) = lower($2)
      limit 1`,
    [parsed.data.contestId, parsed.data.name]
  );
  if (existingByName.rows[0]) {
    res.status(409).json({ error: 'A group with that name already exists for this contest' });
    return;
  }

  const groupId = randomUUID();
  const joinCode = parsed.data.visibility === 'PRIVATE' ? parsed.data.password!.trim() : null;

  await query(
    'insert into groups (id, owner_user_id, name, visibility, join_code) values ($1, $2, $3, $4, $5)',
    [groupId, req.userId, parsed.data.name, parsed.data.visibility, joinCode]
  );

  await query('insert into group_members (group_id, user_id, role) values ($1, $2, $3)', [groupId, req.userId, 'OWNER']);
  await query('insert into group_contests (group_id, contest_id) values ($1, $2)', [groupId, parsed.data.contestId]);

  res.status(201).json({ id: groupId, contestId: parsed.data.contestId, name: parsed.data.name, visibility: parsed.data.visibility });
});

groupsRouter.get('/groups', requireUser, async (req: AuthenticatedRequest, res) => {
  const contestIdParam = req.query.contestId;
  if (contestIdParam !== undefined && typeof contestIdParam !== 'string') {
    res.status(400).json({ error: 'contestId must be a UUID' });
    return;
  }

  if (typeof contestIdParam === 'string') {
    const contestIdValidation = uuidSchema.safeParse(contestIdParam);
    if (!contestIdValidation.success) {
      res.status(400).json({ error: 'contestId must be a UUID' });
      return;
    }
  }

  const result = await query(
    `select g.id, g.name, g.visibility, g.join_code as "joinCode", gm.role,
            g.owner_user_id as "ownerUserId", g.created_at as "createdAt",
            gc.contest_id as "contestId"
     from group_members gm
     join groups g on g.id = gm.group_id
     join group_contests gc on gc.group_id = g.id
     where gm.user_id = $1 and ($2::uuid is null or gc.contest_id = $2::uuid)
     order by g.created_at desc`,
    [req.userId, contestIdParam ?? null]
  );

  res.json({ groups: result.rows });
});

groupsRouter.get('/groups/public', requireUser, async (req: AuthenticatedRequest, res) => {
  const contestIdParam = req.query.contestId;
  if (typeof contestIdParam !== 'string') {
    res.status(400).json({ error: 'contestId query parameter is required' });
    return;
  }

  const contestIdValidation = uuidSchema.safeParse(contestIdParam);
  if (!contestIdValidation.success) {
    res.status(400).json({ error: 'contestId must be a UUID' });
    return;
  }

  const result = await query<{
    id: string;
    contestId: string;
    name: string;
    visibility: 'PUBLIC';
    memberCount: number;
    isMember: boolean;
  }>(
    `select g.id,
            gc.contest_id as "contestId",
            g.name,
            g.visibility,
            count(distinct gm_all.user_id)::int as "memberCount",
            bool_or(gm_me.user_id is not null) as "isMember"
     from groups g
     join group_contests gc on gc.group_id = g.id
     left join group_members gm_all on gm_all.group_id = g.id
     left join group_members gm_me on gm_me.group_id = g.id and gm_me.user_id = $2
     where gc.contest_id = $1 and g.visibility = 'PUBLIC'
     group by g.id, gc.contest_id, g.name, g.visibility
     order by count(distinct gm_all.user_id) desc, g.created_at desc`,
    [contestIdParam, req.userId]
  );

  res.json({ groups: result.rows });
});

groupsRouter.get('/groups/private-names', requireUser, async (req: AuthenticatedRequest, res) => {
  const contestIdParam = req.query.contestId;
  if (typeof contestIdParam !== 'string') {
    res.status(400).json({ error: 'contestId query parameter is required' });
    return;
  }

  const contestIdValidation = uuidSchema.safeParse(contestIdParam);
  if (!contestIdValidation.success) {
    res.status(400).json({ error: 'contestId must be a UUID' });
    return;
  }

  const result = await query<{
    name: string;
  }>(
    `select g.name
     from groups g
     join group_contests gc on gc.group_id = g.id
     where gc.contest_id = $1 and g.visibility = 'PRIVATE'
     order by g.created_at desc`,
    [contestIdParam]
  );

  res.json({ groups: result.rows });
});

groupsRouter.post('/groups/private/join', requireUser, async (req: AuthenticatedRequest, res) => {
  const parsed = joinPrivateGroupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [parsed.data.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const groupResult = await query<{ id: string; join_code: string | null }>(
    `select g.id, g.join_code
       from groups g
       join group_contests gc on gc.group_id = g.id
      where gc.contest_id = $1 and g.visibility = 'PRIVATE' and lower(g.name) = lower($2)
      limit 1`,
    [parsed.data.contestId, parsed.data.name]
  );

  const group = groupResult.rows[0];
  if (!group) {
    res.status(404).json({ error: 'Private group not found' });
    return;
  }

  if ((group.join_code ?? '') !== parsed.data.password) {
    res.status(403).json({ error: 'Invalid group password' });
    return;
  }

  await query(
    'insert into group_members (group_id, user_id, role) values ($1, $2, $3) on conflict (group_id, user_id) do nothing',
    [group.id, req.userId, 'MEMBER']
  );

  res.json({ ok: true, contestId: parsed.data.contestId, groupId: group.id });
});

groupsRouter.post('/groups/:groupId/join', requireUser, async (req: AuthenticatedRequest, res) => {
  const groupIdValidation = uuidSchema.safeParse(req.params.groupId);
  if (!groupIdValidation.success) {
    res.status(400).json({ error: 'groupId must be a UUID' });
    return;
  }

  const parsed = joinGroupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const contestResult = await query<{ id: string }>('select id from contests where id = $1', [parsed.data.contestId]);
  if (!contestResult.rows[0]) {
    res.status(404).json({ error: 'Contest not found' });
    return;
  }

  const groupResult = await query<{ visibility: 'PUBLIC' | 'PRIVATE' }>(
    'select visibility from groups where id = $1',
    [req.params.groupId]
  );

  const group = groupResult.rows[0];
  if (!group) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  const linkResult = await query<{ group_id: string }>(
    'select group_id from group_contests where group_id = $1 and contest_id = $2',
    [req.params.groupId, parsed.data.contestId]
  );
  if (!linkResult.rows[0]) {
    res.status(403).json({ error: 'Group is not available for this contest' });
    return;
  }

  if (group.visibility !== 'PUBLIC') {
    res.status(403).json({ error: 'Private groups must be joined by group name and password' });
    return;
  }

  await query(
    'insert into group_members (group_id, user_id, role) values ($1, $2, $3) on conflict (group_id, user_id) do nothing',
    [req.params.groupId, req.userId, 'MEMBER']
  );

  res.json({ ok: true, contestId: parsed.data.contestId });
});

groupsRouter.get('/groups/:groupId/leaderboard', requireUser, async (req: AuthenticatedRequest, res) => {
  const groupIdValidation = uuidSchema.safeParse(req.params.groupId);
  if (!groupIdValidation.success) {
    res.status(400).json({ error: 'groupId must be a UUID' });
    return;
  }

  const contestId = req.query.contestId;
  if (typeof contestId !== 'string') {
    res.status(400).json({ error: 'contestId query parameter is required' });
    return;
  }

  const contestIdValidation = uuidSchema.safeParse(contestId);
  if (!contestIdValidation.success) {
    res.status(400).json({ error: 'contestId must be a UUID' });
    return;
  }

  const rows = await query<{
    userId: string;
    displayName: string;
    totalPoints: number;
    submittedAt: string | null;
  }>(
    `select e.user_id as "userId", u.display_name as "displayName", e.total_points as "totalPoints", e.submitted_at as "submittedAt"
     from entries e
     join users u on u.id = e.user_id
     join group_members gm on gm.user_id = e.user_id
     where gm.group_id = $1 and e.contest_id = $2
     order by e.total_points desc, e.submitted_at asc nulls last`,
    [req.params.groupId, contestId]
  );

  res.json({ groupId: req.params.groupId, contestId, leaderboard: rows.rows });
});
