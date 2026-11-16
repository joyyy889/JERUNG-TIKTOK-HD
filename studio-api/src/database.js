import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';

const required = ['DB_HOST', 'DB_NAME', 'DB_USER'];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required MySQL setting: ${key}`);
}

export const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  waitForConnections: true,
  connectionLimit: Math.max(2, Number(process.env.DB_POOL_SIZE || 10)),
  queueLimit: 0,
  enableKeepAlive: true,
  charset: 'utf8mb4'
});

export async function initDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      google_sub VARCHAR(191) NOT NULL UNIQUE,
      email VARCHAR(320) NOT NULL,
      display_name VARCHAR(255) NULL,
      avatar_url TEXT NULL,
      email_verified TINYINT(1) NOT NULL DEFAULT 0,
      role VARCHAR(20) NOT NULL DEFAULT 'user',
      disabled TINYINT(1) NOT NULL DEFAULT 0,
      created_at VARCHAR(35) NOT NULL,
      updated_at VARCHAR(35) NOT NULL,
      INDEX idx_users_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NULL,
      original_name VARCHAR(255) NOT NULL,
      input_path TEXT NOT NULL,
      output_path TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'queued',
      processing_mode VARCHAR(40) NULL,
      input_metadata LONGTEXT NULL,
      output_metadata LONGTEXT NULL,
      error_message TEXT NULL,
      created_at VARCHAR(35) NOT NULL,
      updated_at VARCHAR(35) NOT NULL,
      INDEX idx_jobs_created_at (created_at),
      INDEX idx_jobs_user_created (user_id, created_at),
      CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  // Upgrade an existing Project 3 jobs table created before Google login.
  try {
    await db.query('ALTER TABLE jobs ADD COLUMN user_id CHAR(36) NULL AFTER id');
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
  try {
    await db.query('ALTER TABLE jobs ADD INDEX idx_jobs_user_created (user_id, created_at)');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME') throw error;
  }
  try {
    await db.query('ALTER TABLE jobs ADD CONSTRAINT fk_jobs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL');
  } catch (error) {
    if (error.code !== 'ER_DUP_KEYNAME' && error.code !== 'ER_FK_DUP_NAME') throw error;
  }
}

export async function findOrCreateGoogleUser(profile) {
  const googleSub = String(profile.id || '');
  const email = String(profile.emails?.[0]?.value || '').toLowerCase();
  const verified = Boolean(profile._json?.email_verified);
  if (!googleSub || !email || !verified) throw new Error('Google account must provide a verified email address.');
  const now = new Date().toISOString();
  const id = randomUUID();
  const displayName = profile.displayName || email;
  const avatar = profile.photos?.[0]?.value || null;
  await db.execute(`
    INSERT INTO users (id, google_sub, email, display_name, avatar_url, email_verified, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    ON DUPLICATE KEY UPDATE email = VALUES(email), display_name = VALUES(display_name),
      avatar_url = VALUES(avatar_url), email_verified = 1, updated_at = VALUES(updated_at)
  `, [id, googleSub, email, displayName, avatar, now, now]);
  const [rows] = await db.execute(
    'SELECT id, google_sub, email, display_name, avatar_url, role, disabled FROM users WHERE google_sub = ? LIMIT 1',
    [googleSub]
  );
  const user = rows[0];
  if (!user || user.disabled) throw new Error('This JERUNG STUDIO account is disabled.');
  return user;
}

export async function getUserById(id) {
  const [rows] = await db.execute(
    'SELECT id, google_sub, email, display_name, avatar_url, role, disabled FROM users WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] && !rows[0].disabled ? rows[0] : null;
}

export async function getJob(id) {
  const [rows] = await db.execute('SELECT * FROM jobs WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function getUserJob(id, userId) {
  const [rows] = await db.execute('SELECT * FROM jobs WHERE id = ? AND user_id = ?', [id, userId]);
  return rows[0] || null;
}

export async function listCompletedJobs(userId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  const [rows] = await db.execute(
    `SELECT * FROM jobs WHERE user_id = ? AND status = 'completed' ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [userId]
  );
  return rows;
}

export async function insertJob({ id, userId, originalName, inputPath, now }) {
  await db.execute(
    "INSERT INTO jobs (id, user_id, original_name, input_path, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    [id, userId, String(originalName).slice(0, 255), inputPath, now, now]
  );
}

export async function updateJob(id, fields) {
  const allowed = [
    'output_path', 'status', 'processing_mode', 'input_metadata',
    'output_metadata', 'error_message', 'updated_at'
  ];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const set = entries.map(([key]) => `${key} = ?`).join(', ');
  await db.execute(`UPDATE jobs SET ${set} WHERE id = ?`, [
    ...entries.map(([, value]) => value),
    id
  ]);
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.display_name,
    picture: user.avatar_url,
    role: user.role
  };
}

export function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    originalName: row.original_name,
    status: row.status,
    processingMode: row.processing_mode,
    inputMetadata: row.input_metadata ? JSON.parse(row.input_metadata) : null,
    outputMetadata: row.output_metadata ? JSON.parse(row.output_metadata) : null,
    error: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    downloadUrl: row.status === 'completed' ? `/api/videos/${row.id}/download` : null
  };
}
