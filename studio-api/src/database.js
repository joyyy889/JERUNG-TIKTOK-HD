import mysql from 'mysql2/promise';

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
    CREATE TABLE IF NOT EXISTS jobs (
      id CHAR(36) PRIMARY KEY,
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
      INDEX idx_jobs_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function getJob(id) {
  const [rows] = await db.execute('SELECT * FROM jobs WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listCompletedJobs(limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  const [rows] = await db.query(
    `SELECT * FROM jobs WHERE status = 'completed' ORDER BY created_at DESC LIMIT ${safeLimit}`
  );
  return rows;
}

export async function insertJob({ id, originalName, inputPath, now }) {
  await db.execute(
    "INSERT INTO jobs (id, original_name, input_path, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
    [id, String(originalName).slice(0, 255), inputPath, now, now]
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
