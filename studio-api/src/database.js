import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const dataDir = path.resolve(process.env.DATA_DIR || './data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.resolve(process.env.DATABASE_PATH || path.join(dataDir, 'jerung-studio.sqlite'));
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    original_name TEXT NOT NULL,
    input_path TEXT NOT NULL,
    output_path TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    processing_mode TEXT,
    input_metadata TEXT,
    output_metadata TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
`);

export function updateJob(id, fields) {
  const allowed = [
    'output_path', 'status', 'processing_mode', 'input_metadata',
    'output_metadata', 'error_message', 'updated_at'
  ];
  const entries = Object.entries(fields).filter(([key]) => allowed.includes(key));
  if (!entries.length) return;
  const set = entries.map(([key]) => `${key} = @${key}`).join(', ');
  db.prepare(`UPDATE jobs SET ${set} WHERE id = @id`).run({
    id,
    ...Object.fromEntries(entries)
  });
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