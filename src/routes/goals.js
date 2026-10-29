import { Router } from 'express';
import { query } from '../db.js';
import { wrap } from '../utils.js';

const router = Router();

const mapGoal = (r) => ({ id: Number(r.id), userEmail: r.user_email, title: r.title, target: r.target, current: r.current });

router.get('/', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM goals WHERE user_email = $1 ORDER BY id', [req.email]);
  res.json(rows.map(mapGoal));
}));

router.post('/', wrap(async (req, res) => {
  const title = req.body?.title == null ? '' : String(req.body.title).trim();
  if (!title) return res.status(400).json({ error: 'Title required' });

  let target = parseInt(req.body?.target ?? 1, 10);
  if (Number.isNaN(target) || target < 1) target = 1;

  const { rows } = await query(
    'INSERT INTO goals (user_email, title, target, current) VALUES ($1, $2, $3, 0) RETURNING *',
    [req.email, title, target]
  );
  res.json(mapGoal(rows[0]));
}));

router.put('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const found = Number.isNaN(id) ? { rows: [] } : await query('SELECT * FROM goals WHERE id = $1 AND user_email = $2', [id, req.email]);
  if (!found.rows[0]) return res.sendStatus(404);

  let current = found.rows[0].current;
  if (req.body?.current != null) {
    const c = parseInt(req.body.current, 10);
    if (!Number.isNaN(c)) current = Math.max(0, c);
  }
  const { rows } = await query('UPDATE goals SET current = $1 WHERE id = $2 RETURNING *', [current, id]);
  res.json(mapGoal(rows[0]));
}));

router.delete('/:id', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isNaN(id)) await query('DELETE FROM goals WHERE id = $1 AND user_email = $2', [id, req.email]);
  res.json({ message: 'Deleted' });
}));

export default router;
