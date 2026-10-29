import { Router } from 'express';
import { query, mapUser, findUserByEmail, recomputeRanks } from '../db.js';
import { wrap, cleanHandle, httpGet, httpPost, getJson } from '../utils.js';

const router = Router();

const githubToken = () => process.env.GITHUB_TOKEN || '';
const has = (s) => s != null && String(s).trim() !== '';
const orEmpty = (s) => (s != null ? s : '');

async function currentUser(req) {
  const user = await findUserByEmail(req.email);
  if (!user) throw new Error('User not found');
  return user;
}

router.get('/profile', wrap(async (req, res) => {
  const u = await currentUser(req);
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    score: u.score,
    rank: u.rank,
    problems: u.problems,
    streak: u.streak,
    githubUsername: orEmpty(u.githubUsername),
    leetcodeUsername: orEmpty(u.leetcodeUsername),
    codeforcesUsername: orEmpty(u.codeforcesUsername),
    hackerrankUsername: orEmpty(u.hackerrankUsername),
  });
}));

router.put('/profile', wrap(async (req, res) => {
  const u = await currentUser(req);
  const updates = req.body || {};

  if (updates.name) u.name = updates.name;
  if ('githubUsername' in updates) u.githubUsername = cleanHandle(updates.githubUsername);
  if ('leetcodeUsername' in updates) u.leetcodeUsername = cleanHandle(updates.leetcodeUsername);
  if ('codeforcesUsername' in updates) u.codeforcesUsername = cleanHandle(updates.codeforcesUsername);
  if ('hackerrankUsername' in updates) u.hackerrankUsername = cleanHandle(updates.hackerrankUsername);

  await query(
    `UPDATE users SET name=$1, github_username=$2, leetcode_username=$3, codeforces_username=$4, hackerrank_username=$5 WHERE id=$6`,
    [u.name, u.githubUsername, u.leetcodeUsername, u.codeforcesUsername, u.hackerrankUsername, u.id]
  );

  res.json({
    message: 'Profile updated!',
    name: u.name,
    githubUsername: orEmpty(u.githubUsername),
    leetcodeUsername: orEmpty(u.leetcodeUsername),
    codeforcesUsername: orEmpty(u.codeforcesUsername),
    hackerrankUsername: orEmpty(u.hackerrankUsername),
  });
}));

router.get('/leaderboard', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM users ORDER BY score DESC, id ASC LIMIT 10');
  res.json(
    rows.map(mapUser).map((u, i) => ({
      name: u.name,
      score: u.score,
      rank: i + 1,
      platform: has(u.githubUsername) ? 'GitHub' : 'LeetCode',
      isMe: u.email != null && u.email === req.email,
    }))
  );
}));

router.delete('/account', wrap(async (req, res) => {
  const u = await currentUser(req);
  await query('DELETE FROM users WHERE id = $1', [u.id]);
  await recomputeRanks();
  res.json({ message: 'Account deleted' });
}));

router.put('/update-stats', wrap(async (req, res) => {
  const u = await currentUser(req);
  const stats = req.body || {};
  const score = Number.isInteger(stats.score) ? stats.score : u.score;
  const problems = Number.isInteger(stats.problems) ? stats.problems : u.problems;
  const streak = Number.isInteger(stats.streak) ? stats.streak : u.streak;

  await query('UPDATE users SET score=$1, problems=$2, streak=$3 WHERE id=$4', [score, problems, streak, u.id]);
  await recomputeRanks();
  const fresh = await findUserByEmail(req.email);
  res.json({ message: 'Stats updated!', score: fresh.score, rank: fresh.rank });
}));

router.get('/github/:username', wrap(async (req, res) => {
  try {
    const { status, text } = await httpGet(`https://api.github.com/users/${encodeURIComponent(req.params.username)}`, {
      bearer: githubToken(),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'VortexApp' },
    });
    if (status !== 200) {
      let error;
      if (status === 404) error = 'GitHub user not found';
      else if (status === 403 || status === 429) error = 'GitHub rate limit reached, thodi der baad try karo';
      else error = `GitHub request failed (status ${status})`;
      return res.status(status === 404 ? 404 : 502).json({ error });
    }
    res.type('application/json').send(text);
  } catch (e) {
    res.status(400).json({ error: `GitHub fetch failed: ${e.message}` });
  }
}));

const CONTRIB_QUERY =
  'query($login:String!){ user(login:$login){ contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } } } }';

async function githubCalendar(username) {
  const { text } = await httpPost('https://api.github.com/graphql', { query: CONTRIB_QUERY, variables: { login: username } }, { bearer: githubToken() });
  return JSON.parse(text)?.data?.user?.contributionsCollection?.contributionCalendar;
}

router.get('/github-contributions/:username', wrap(async (req, res) => {
  try {
    const cal = await githubCalendar(req.params.username);
    if (!cal || !cal.weeks) return res.status(404).json({ error: 'GitHub contributions not available' });

    const days = [];
    for (const week of cal.weeks) {
      for (const day of week.contributionDays) days.push({ date: day.date ?? '', count: day.contributionCount ?? 0 });
    }
    res.json({ totalContributions: cal.totalContributions ?? 0, days });
  } catch (e) {
    res.status(502).json({ error: `GitHub contributions fetch failed: ${e.message}` });
  }
}));

router.get('/leetcode/:username', wrap(async (req, res) => {
  try {
    const q = 'query($u:String!){ matchedUser(username:$u){ username submitStats: submitStatsGlobal { acSubmissionNum { difficulty count } } profile { ranking } } }';
    const { status, text } = await httpPost('https://leetcode.com/graphql', { query: q, variables: { u: req.params.username } }, { headers: { Referer: 'https://leetcode.com' } });
    if (status !== 200) return res.status(400).json({ error: 'LeetCode user not found' });
    res.type('application/json').send(text);
  } catch (e) {
    res.status(400).json({ error: `LeetCode fetch failed: ${e.message}` });
  }
}));

function cfSolvedSet(statusJson) {
  const done = new Set();
  for (const s of statusJson.result || []) {
    if (s.verdict === 'OK') done.add(`${s.problem?.contestId ?? ''}${s.problem?.index ?? ''}`);
  }
  return done;
}

router.get('/codeforces/:username', wrap(async (req, res) => {
  const username = req.params.username;
  try {
    const info = await getJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`);
    if (info.status !== 'OK') return res.status(404).json({ error: 'Codeforces user not found' });
    const u = info.result[0];

    let solved = 0;
    try {
      const st = await getJson(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(username)}&from=1&count=10000`);
      if (st.status === 'OK') solved = cfSolvedSet(st).size;
    } catch { /* rating is still returned */ }

    res.json({
      handle: u.handle ?? username,
      rating: u.rating ?? 0,
      maxRating: u.maxRating ?? 0,
      rank: u.rank ?? '',
      maxRank: u.maxRank ?? '',
      solved,
    });
  } catch (e) {
    res.status(502).json({ error: `Codeforces fetch failed: ${e.message}` });
  }
}));

router.get('/hackerrank/:username', wrap(async (req, res) => {
  const username = req.params.username;
  try {
    const d = await getJson(`https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/badges`);
    if (!d.status) return res.status(404).json({ error: 'HackerRank user not found' });

    let totalStars = 0;
    let totalSolved = 0;
    const badges = (d.models || []).map((m) => {
      const stars = m.total_stars ?? 0;
      const solved = m.solved ?? 0;
      totalStars += stars;
      totalSolved += solved;
      return { name: m.badge_name ?? '', stars, solved };
    });
    res.json({ username, badges, totalStars, totalSolved });
  } catch (e) {
    res.status(502).json({ error: `HackerRank fetch failed: ${e.message}` });
  }
}));

router.get('/atcoder/:username', wrap(async (req, res) => {
  const username = req.params.username;
  try {
    let accepted = 0;
    try {
      const info = await getJson(`https://kenkoooo.com/atcoder/atcoder-api/v2/user_info?user=${encodeURIComponent(username)}`);
      accepted = info.accepted_count ?? 0;
    } catch { /* ignore */ }

    let rating = 0;
    try {
      const hist = await getJson(`https://atcoder.jp/users/${encodeURIComponent(username)}/history/json`);
      if (Array.isArray(hist) && hist.length > 0) rating = hist[hist.length - 1].NewRating ?? 0;
    } catch { /* ignore */ }

    if (accepted === 0 && rating === 0) return res.status(404).json({ error: 'AtCoder user not found' });
    res.json({ username, acceptedCount: accepted, rating });
  } catch (e) {
    res.status(502).json({ error: `AtCoder fetch failed: ${e.message}` });
  }
}));

router.get('/contests', wrap(async (req, res) => {
  try {
    const d = await getJson('https://codeforces.com/api/contest.list?gym=false');
    let upcoming = [];
    if (d.status === 'OK') {
      upcoming = d.result
        .filter((c) => c.phase === 'BEFORE')
        .map((c) => ({
          name: c.name,
          startTimeSeconds: c.startTimeSeconds ?? 0,
          durationSeconds: c.durationSeconds ?? 0,
          url: 'https://codeforces.com/contests',
        }))
        .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds)
        .slice(0, 12);
    }
    res.json(upcoming);
  } catch {
    res.json([]);
  }
}));

router.get('/skill-radar/:handle', wrap(async (req, res) => {
  try {
    const d = await getJson(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(req.params.handle)}&from=1&count=10000`);
    if (d.status !== 'OK') return res.status(404).json({ error: 'Codeforces user not found' });

    const tagProblems = new Map();
    for (const s of d.result) {
      if (s.verdict !== 'OK') continue;
      const key = `${s.problem?.contestId ?? ''}${s.problem?.index ?? ''}`;
      for (const tag of s.problem?.tags || []) {
        if (!tagProblems.has(tag)) tagProblems.set(tag, new Set());
        tagProblems.get(tag).add(key);
      }
    }
    const radar = [...tagProblems.entries()]
      .map(([tag, set]) => ({ tag, count: set.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    res.json(radar);
  } catch (e) {
    res.status(502).json({ error: `Skill radar failed: ${e.message}` });
  }
}));

async function leetcodeStats(username) {
  const q = 'query($u:String!){ matchedUser(username:$u){ submitStats: submitStatsGlobal { acSubmissionNum { difficulty count } } } }';
  const d = JSON.parse((await httpPost('https://leetcode.com/graphql', { query: q, variables: { u: username } }, { headers: { Referer: 'https://leetcode.com' } })).text);
  let easy = 0, med = 0, hard = 0, total = 0;
  for (const n of d?.data?.matchedUser?.submitStats?.acSubmissionNum || []) {
    const c = n.count ?? 0;
    if (n.difficulty === 'Easy') easy = c;
    else if (n.difficulty === 'Medium') med = c;
    else if (n.difficulty === 'Hard') hard = c;
    else if (n.difficulty === 'All') total = c;
  }
  return [easy * 10 + med * 30 + hard * 50, total];
}

async function codeforcesStats(username) {
  const info = await getJson(`https://codeforces.com/api/user.info?handles=${encodeURIComponent(username)}`);
  if (info.status !== 'OK') return [0, 0];
  const rating = info.result[0].rating ?? 0;

  let solved = 0;
  try {
    const st = await getJson(`https://codeforces.com/api/user.status?handle=${encodeURIComponent(username)}&from=1&count=10000`);
    if (st.status === 'OK') solved = cfSolvedSet(st).size;
  } catch { /* rating still gives a score */ }

  return [solved * 20 + Math.max(0, rating - 1000), solved];
}

async function githubScore(username) {
  const d = await getJson(`https://api.github.com/users/${encodeURIComponent(username)}`, { bearer: githubToken() });
  return (d.public_repos ?? 0) * 5 + (d.followers ?? 0) * 10;
}

async function githubStreak(username) {
  const cal = await githubCalendar(username);
  const counts = [];
  for (const week of cal?.weeks || []) for (const day of week.contributionDays) counts.push(day.contributionCount ?? 0);

  let i = counts.length - 1;
  let streak = 0;
  if (i >= 0 && counts[i] === 0) i--;
  while (i >= 0 && counts[i] > 0) { streak++; i--; }
  return streak;
}

async function hackerrankStats(username) {
  const d = await getJson(`https://www.hackerrank.com/rest/hackers/${encodeURIComponent(username)}/badges`);
  let stars = 0, solved = 0;
  for (const m of d.models || []) { stars += m.total_stars ?? 0; solved += m.solved ?? 0; }
  return [stars * 20 + solved * 5, solved];
}

router.put('/sync', wrap(async (req, res) => {
  const user = await currentUser(req);
  let score = 0;
  let problems = 0;
  const breakdown = { github: 0, leetcode: 0, codeforces: 0, hackerrank: 0 };

  if (has(user.leetcodeUsername)) {
    try { const [s, p] = await leetcodeStats(user.leetcodeUsername); score += s; problems += p; breakdown.leetcode = s; } catch { /* skip platform */ }
  }
  if (has(user.codeforcesUsername)) {
    try { const [s, p] = await codeforcesStats(user.codeforcesUsername); score += s; problems += p; breakdown.codeforces = s; } catch { /* skip */ }
  }
  if (has(user.githubUsername)) {
    try { const s = await githubScore(user.githubUsername); score += s; breakdown.github = s; } catch { /* skip */ }
    try { user.streak = await githubStreak(user.githubUsername); } catch { /* keep old streak */ }
  }
  if (has(user.hackerrankUsername)) {
    try { const [s, p] = await hackerrankStats(user.hackerrankUsername); score += s; problems += p; breakdown.hackerrank = s; } catch { /* skip */ }
  }

  await query('UPDATE users SET score=$1, problems=$2, streak=$3 WHERE id=$4', [score, problems, user.streak, user.id]);
  await recomputeRanks();
  const fresh = await findUserByEmail(req.email);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const existing = await query('SELECT id FROM score_snapshots WHERE user_email=$1 AND snap_date=$2', [req.email, today]);
    if (existing.rowCount > 0) {
      await query('UPDATE score_snapshots SET score=$1, problems=$2, "rank"=$3, streak=$4 WHERE id=$5',
        [fresh.score, fresh.problems, fresh.rank, fresh.streak, existing.rows[0].id]);
    } else {
      await query('INSERT INTO score_snapshots (user_email, snap_date, score, problems, "rank", streak) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.email, today, fresh.score, fresh.problems, fresh.rank, fresh.streak]);
    }
  } catch { /* snapshot is best-effort */ }

  res.json({
    message: 'Stats synced from your platforms!',
    score: fresh.score,
    problems: fresh.problems,
    rank: fresh.rank,
    breakdown,
  });
}));

router.get('/history', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM score_snapshots WHERE user_email = $1 ORDER BY snap_date ASC', [req.email]);
  res.json(rows.map((s) => ({ date: s.snap_date, score: s.score, problems: s.problems, rank: s.rank, streak: s.streak })));
}));

router.get('/search', wrap(async (req, res) => {
  const q = req.query.query;
  if (typeof q !== 'string') return res.status(400).json({ error: 'query required' });
  const like = `%${q.toLowerCase()}%`;
  const { rows } = await query(
    'SELECT * FROM users WHERE LOWER(name) LIKE $1 OR LOWER(github_username) LIKE $1 ORDER BY id',
    [like]
  );
  res.json(
    rows.map(mapUser).map((u) => ({
      name: u.name,
      score: u.score,
      rank: u.rank,
      problems: u.problems,
      githubUsername: orEmpty(u.githubUsername),
      leetcodeUsername: orEmpty(u.leetcodeUsername),
    }))
  );
}));

async function gemini(system, userPrompt, temperature) {
  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const { text } = await httpPost(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 4096, temperature },
    },
    { timeout: 90000 }
  );
  const d = JSON.parse(text);
  const out = (d?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!out) {
    const err = new Error(`AI returned no text: ${d?.error?.message ?? 'unknown'}`);
    err.aiEmpty = true;
    throw err;
  }
  return out;
}

function platformList(user, withHandles) {
  const p = [];
  const add = (name, h) => { if (has(h)) p.push(withHandles ? `${name} (@${h})` : name); };
  add('GitHub', user.githubUsername);
  add('LeetCode', user.leetcodeUsername);
  add('Codeforces', user.codeforcesUsername);
  add('HackerRank', user.hackerrankUsername);
  return p;
}

router.post('/ai-coach', wrap(async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI coach not configured' });
  const user = await currentUser(req);

  const platforms = platformList(user, false);
  let stats =
    `Name: ${user.name}\nDev Score: ${user.score}\nGlobal Rank: #${user.rank}\n` +
    `Total problems solved: ${user.problems}\nCurrent streak: ${user.streak} days\n` +
    `Connected platforms: ${platforms.length ? platforms.join(', ') : 'none'}\n`;
  if (req.body?.breakdown != null) stats += `Score breakdown by platform: ${JSON.stringify(req.body.breakdown)}\n`;

  const system =
    "You are an expert developer career coach. Given a developer's real coding stats " +
    'across GitHub, LeetCode, Codeforces and HackerRank, give sharp, specific, encouraging career advice.';
  const prompt =
    `Here are the developer's real stats:\n${stats}\n` +
    "Give: (1) their single biggest strength, (2) the most important area to improve, " +
    '(3) two concrete next steps, (4) a one-line interview-readiness verdict. ' +
    "Address them as 'you'. Keep it under 180 words, use short bullet points.";

  try {
    res.json({ insights: await gemini(system, prompt, 0.7) });
  } catch (e) {
    res.status(502).json({ error: e.aiEmpty ? e.message : `AI request failed: ${e.message}` });
  }
}));

router.post('/ai-resume', wrap(async (req, res) => {
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'AI not configured' });
  const user = await currentUser(req);

  const platforms = platformList(user, true);
  let stats =
    `Name: ${user.name}\nDev Score: ${user.score}\nGlobal Rank: #${user.rank}\n` +
    `Total problems solved: ${user.problems}\nCurrent streak: ${user.streak} days\n` +
    `Platforms: ${platforms.length ? platforms.join(', ') : 'none'}\n`;
  if (req.body?.breakdown != null) stats += `Score breakdown by platform: ${JSON.stringify(req.body.breakdown)}\n`;

  const system =
    'You are a professional resume writer for software engineers. ' +
    'Output PLAIN TEXT ONLY — absolutely no markdown symbols (no **, no #, no backticks, no dashes as bullets; use a simple bullet character). ' +
    'Use UPPERCASE section headers. Do not invent facts beyond the given stats.';
  const prompt =
    `Create a concise, recruiter-ready developer resume from these REAL verified coding stats:\n${stats}\n` +
    'Sections in this exact order (plain text):\n' +
    'PROFESSIONAL SUMMARY (2-3 sentences)\nTECHNICAL STRENGTHS\n' +
    'COMPETITIVE PROGRAMMING (highlight the numbers)\nKEY HIGHLIGHTS (3-4 impressive points)\n' +
    'Keep the whole resume under 250 words. Confident, professional tone.';

  try {
    res.json({ resume: await gemini(system, prompt, 0.6) });
  } catch (e) {
    res.status(502).json({ error: e.aiEmpty ? e.message : `AI request failed: ${e.message}` });
  }
}));

export default router;
