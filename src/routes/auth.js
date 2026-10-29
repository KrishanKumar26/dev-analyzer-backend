import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { query, findUserByEmail } from '../db.js';
import { generateToken } from '../middleware/auth.js';
import { wrap } from '../utils.js';

const router = Router();

const authResponse = (user, token) => ({
  token,
  name: user.name,
  email: user.email,
  score: user.score,
  rank: user.rank,
  streak: user.streak,
});

router.post('/register', wrap(async (req, res) => {
  const { name, email, password, githubUsername, leetcodeUsername } = req.body || {};
  try {
    if (!email || !password) throw new Error('Email and password required');
    if (await findUserByEmail(email)) throw new Error('Email already registered!');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await query(
      `INSERT INTO users (name, email, password, score, "rank", problems, streak, github_username, leetcode_username)
       VALUES ($1, $2, $3, 0, 9999, 0, 0, $4, $5) RETURNING *`,
      [name, email, hash, githubUsername || null, leetcodeUsername || null]
    );
    const user = await findUserByEmail(rows[0].email);
    res.json(authResponse(user, generateToken(user.email)));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  try {
    const user = await findUserByEmail(email);
    if (!user) throw new Error('User not found!');
    if (!password || !(await bcrypt.compare(password, user.password))) throw new Error('Wrong password!');
    res.json(authResponse(user, generateToken(user.email)));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
}));

const escapeHtml = (s) => (s == null ? '' : String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;'));

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || 'Dev Analyzer <onboarding@resend.dev>',
      to: [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (r.status >= 400) throw new Error(`Resend HTTP ${r.status}: ${await r.text()}`);
}

router.post('/forgot-password', wrap(async (req, res) => {
  if (!process.env.RESEND_API_KEY) {
    return res.status(503).json({ error: 'Email service not configured' });
  }
  let email = req.body?.email;
  if (!email || !String(email).trim()) return res.status(400).json({ error: 'Email required' });
  email = String(email).trim();

  const user = await findUserByEmail(email);
  if (user) {
    await query('DELETE FROM password_reset_tokens WHERE email = $1', [email]);
    const token = crypto.randomUUID().replace(/-/g, '');
    await query('INSERT INTO password_reset_tokens (email, token, expires_at) VALUES ($1, $2, $3)', [
      email,
      token,
      Date.now() + 30 * 60 * 1000,
    ]);

    const frontendUrl = process.env.FRONTEND_URL || 'https://dev-analyzer-frontend.vercel.app';
    const link = `${frontendUrl}/reset?token=${token}`;
    const html =
      '<div style="font-family:sans-serif;max-width:480px;margin:auto">' +
      '<h2>Reset your Dev Analyzer password</h2>' +
      `<p>Hi ${escapeHtml(user.name)}, click below to set a new password. Link expires in 30 minutes.</p>` +
      `<p><a href="${link}" style="background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block">Reset Password</a></p>` +
      '<p style="color:#888;font-size:12px">Agar tumne request nahi kiya to ignore karo.</p>' +
      `<p style="color:#888;font-size:12px">Or paste this link: ${link}</p></div>`;
    try {
      await sendEmail(email, 'Reset your Dev Analyzer password', html);
    } catch (e) {
      return res.status(502).json({ error: `Failed to send email: ${e.message}` });
    }
  }
  res.json({ message: 'If that email is registered, a reset link has been sent.' });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || password.length < 6) {
    return res.status(400).json({ error: 'Token and a password (6+ chars) required' });
  }
  const { rows } = await query('SELECT * FROM password_reset_tokens WHERE token = $1', [String(token).trim()]);
  const prt = rows[0];
  if (!prt || Number(prt.expires_at) < Date.now()) {
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }
  const user = await findUserByEmail(prt.email);
  if (!user) return res.status(400).json({ error: 'User not found' });

  await query('UPDATE users SET password = $1 WHERE id = $2', [await bcrypt.hash(password, 10), user.id]);
  await query('DELETE FROM password_reset_tokens WHERE id = $1', [prt.id]);
  res.json({ message: 'Password reset! Ab naye password se login karo.' });
}));

export default router;
