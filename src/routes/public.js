import { Router } from 'express';
import { query, mapUser } from '../db.js';
import { wrap } from '../utils.js';

const router = Router();

const getUserById = async (id) => {
  if (!Number.isInteger(id)) return null;
  const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
  return mapUser(rows[0]);
};

function addPlatform(list, name, username, baseUrl) {
  if (username && String(username).trim()) {
    list.push({ platform: name, username, url: baseUrl + username });
  }
}

router.get('/profile/:id', wrap(async (req, res) => {
  const u = await getUserById(parseInt(req.params.id, 10));
  if (!u) return res.status(404).json({ error: 'Profile not found' });

  const platforms = [];
  addPlatform(platforms, 'GitHub', u.githubUsername, 'https://github.com/');
  addPlatform(platforms, 'LeetCode', u.leetcodeUsername, 'https://leetcode.com/u/');
  addPlatform(platforms, 'Codeforces', u.codeforcesUsername, 'https://codeforces.com/profile/');
  addPlatform(platforms, 'HackerRank', u.hackerrankUsername, 'https://www.hackerrank.com/profile/');

  res.json({ name: u.name, score: u.score, rank: u.rank, streak: u.streak, problems: u.problems, platforms });
}));

router.get('/badge/:id.svg', wrap(async (req, res) => {
  const u = await getUserById(parseInt(req.params.id, 10));
  const score = u ? u.score : 0;
  const rank = u ? `#${u.rank}` : '#-';

  const label = 'DEV SCORE';
  const value = `${score}  ·  ${rank}`;
  const labelW = 12 + label.length * 7;
  const valueW = 14 + value.length * 7;
  const total = labelW + valueW;
  const labelX = Math.floor(labelW / 2);
  const valueX = labelW + Math.floor(valueW / 2);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="Dev Score ${value}">` +
    '<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-opacity=".12"/></linearGradient>' +
    `<clipPath id="r"><rect width="${total}" height="20" rx="4" fill="#fff"/></clipPath>` +
    '<g clip-path="url(#r)">' +
    `<rect width="${labelW}" height="20" fill="#1f2937"/>` +
    `<rect x="${labelW}" width="${valueW}" height="20" fill="#059669"/>` +
    `<rect width="${total}" height="20" fill="url(#s)"/>` +
    '</g>' +
    '<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">' +
    `<text x="${labelX}" y="14">${label}</text>` +
    `<text x="${valueX}" y="14">${value}</text>` +
    '</g></svg>';

  res.set('Content-Type', 'image/svg+xml').set('Cache-Control', 'max-age=3600').send(svg);
}));

export default router;
