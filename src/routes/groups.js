import { Router } from 'express';
import crypto from 'node:crypto';
import { query, mapUser } from '../db.js';
import { wrap } from '../utils.js';

const router = Router();

const members = async (code) => (await query('SELECT * FROM group_memberships WHERE code = $1 ORDER BY id', [code])).rows;

router.post('/create', wrap(async (req, res) => {
  const name = req.body?.name;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Group name required' });

  const code = crypto.randomUUID().slice(0, 6).toUpperCase();
  await query('INSERT INTO group_memberships (code, group_name, member_email) VALUES ($1, $2, $3)', [
    code,
    String(name).trim(),
    req.email,
  ]);
  res.json({ code, name: String(name).trim(), message: 'Group created!' });
}));

router.post('/join', wrap(async (req, res) => {
  let code = req.body?.code;
  if (!code || !String(code).trim()) return res.status(400).json({ error: 'Group code required' });
  code = String(code).trim().toUpperCase();

  const list = await members(code);
  if (list.length === 0) return res.status(404).json({ error: 'Group not found' });

  const groupName = list[0].group_name;
  const already = await query('SELECT 1 FROM group_memberships WHERE code = $1 AND member_email = $2', [code, req.email]);
  if (already.rowCount === 0) {
    await query('INSERT INTO group_memberships (code, group_name, member_email) VALUES ($1, $2, $3)', [code, groupName, req.email]);
  }
  res.json({ code, name: groupName, message: 'Joined group!' });
}));

router.get('/mine', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM group_memberships WHERE member_email = $1 ORDER BY id', [req.email]);
  const out = [];
  for (const m of rows) {
    const count = await query('SELECT COUNT(*)::int AS n FROM group_memberships WHERE code = $1', [m.code]);
    out.push({ code: m.code, name: m.group_name, members: count.rows[0].n });
  }
  res.json(out);
}));

router.get('/:code/leaderboard', wrap(async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const list = await members(code);
  if (list.length === 0) return res.status(404).json({ error: 'Group not found' });

  const emails = list.map((m) => m.member_email);
  const { rows } = await query('SELECT * FROM users WHERE email = ANY($1::text[])', [emails]);
  const users = rows.map(mapUser).sort((a, b) => b.score - a.score);

  const leaderboard = users.map((u, i) => ({
    name: u.name,
    score: u.score,
    problems: u.problems,
    rank: i + 1,
    isMe: u.email != null && u.email === req.email,
  }));
  res.json({ name: list[0].group_name, code, leaderboard });
}));

router.delete('/:code/leave', wrap(async (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  await query('DELETE FROM group_memberships WHERE code = $1 AND member_email = $2', [code, req.email]);
  res.json({ message: 'Left group' });
}));

export default router;
