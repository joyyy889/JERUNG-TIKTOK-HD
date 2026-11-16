import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { db, publicJob } from './database.js';
import { createJob, recoverQueuedJobs } from './processor.js';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const apiKey = process.env.API_KEY || '';
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 500));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

if (process.env.NODE_ENV === 'production' && apiKey.length < 32) {
  throw new Error('Set API_KEY to a random secret of at least 32 characters before production startup.');
}
fs.mkdirSync(uploadDir, { recursive: true });

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map(value => value.trim()),
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key']
}));
app.use(express.json({ limit: '32kb' }));

function requireApiKey(req, res, next) {
  const supplied = req.get('x-api-key') || '';
  const expected = apiKey;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.incoming`)
});
const upload = multer({
  storage,
  limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 }
});

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'jerung-studio-api' }));

app.post('/api/videos', requireApiKey, (req, res, next) => {
  upload.single('video')(req, res, error => {
    if (error) return next(error);
    try {
      if (!req.file) return res.status(400).json({ error: 'Upload one video using the video field.' });
      const id = createJob(req.file, req.file.originalname);
      const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
      return res.status(202).json({ job: publicJob(row) });
    } catch (err) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return next(err);
    }
  });
});

app.get('/api/jobs/:id', requireApiKey, (req, res) => {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: publicJob(row) });
});

app.get('/api/videos', requireApiKey, (_req, res) => {
  const rows = db.prepare("SELECT * FROM jobs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 100").all();
  res.json({ videos: rows.map(publicJob) });
});

app.get('/api/videos/:id/download', requireApiKey, (req, res) => {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND status = 'completed'").get(req.params.id);
  if (!row || !row.output_path || !fs.existsSync(row.output_path)) {
    return res.status(404).json({ error: 'Processed video not found' });
  }
  res.download(row.output_path, `${row.id}.mp4`);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Video exceeds the ${maxUploadMb} MB upload limit.` });
  }
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : error.message });
});

app.listen(port, host, () => {
  // Jobs interrupted by a restart are queued again; processing remains sequential by default.
  db.prepare("UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'processing'")
    .run(new Date().toISOString());
  console.log(`JERUNG STUDIO API listening on http://${host}:${port}`);
  recoverQueuedJobs();
});