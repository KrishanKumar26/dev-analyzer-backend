import pg from 'pg';

const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
});

export const query = (text, params) => pool.query(text, params);

export async function initDb() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255),
      email VARCHAR(255) UNIQUE,
      password VARCHAR(255),
      score INTEGER NOT NULL DEFAULT 0,
      "rank" INTEGER NOT NULL DEFAULT 0,
      problems INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0,
      github_username VARCHAR(255),
      leetcode_username VARCHAR(255),
      codeforces_username VARCHAR(255),
      hackerrank_username VARCHAR(255)
    );
    CREATE TABLE IF NOT EXISTS goals (
      id BIGSERIAL PRIMARY KEY,
      user_email VARCHAR(255),
      title VARCHAR(255),
      target INTEGER NOT NULL DEFAULT 0,
      current INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS group_memberships (
      id BIGSERIAL PRIMARY KEY,
      code VARCHAR(255),
      group_name VARCHAR(255),
      member_email VARCHAR(255)
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(255),
      token VARCHAR(255),
      expires_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS score_snapshots (
      id BIGSERIAL PRIMARY KEY,
      user_email VARCHAR(255),
      snap_date VARCHAR(255),
      score INTEGER NOT NULL DEFAULT 0,
      problems INTEGER NOT NULL DEFAULT 0,
      "rank" INTEGER NOT NULL DEFAULT 0,
      streak INTEGER NOT NULL DEFAULT 0
    );
  `);
}

export function mapUser(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    name: r.name,
    email: r.email,
    password: r.password,
    score: r.score,
    rank: r.rank,
    problems: r.problems,
    streak: r.streak,
    githubUsername: r.github_username,
    leetcodeUsername: r.leetcode_username,
    codeforcesUsername: r.codeforces_username,
    hackerrankUsername: r.hackerrank_username,
  };
}

export async function findUserByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return mapUser(rows[0]);
}

export async function recomputeRanks() {
  await query(`
    UPDATE users u SET "rank" = s.r
    FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY score DESC, id ASC) AS r FROM users) s
    WHERE u.id = s.id
  `);
}
