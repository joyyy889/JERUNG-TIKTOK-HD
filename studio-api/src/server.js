import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { rateLimit } from 'express-rate-limit';
import {
  db, initDatabase, findOrCreateGoogleUser, getUserById, getUserJob,
  listCompletedJobs, publicJob, publicUser
} from './database.js';
import { createJob, recoverQueuedJobs } from './processor.js';

const app = express();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const maxUploadMb = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 500));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const allowedOrigins = (process.env.CORS_ORIGIN || frontendUrl).split(',').map(value => value.trim()).filter(Boolean);
const isProduction = process.env.NODE_ENV === 'production';

for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL', 'SESSION_SECRET']) {
  if (!process.env[key]) throw new Error(`Missing required authentication setting: ${key}`);
}
if (isProduction && process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must contain at least 32 characters in production.');
}
fs.mkdirSync(uploadDir, { recursive: true });

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
  credentials: true,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '32kb' }));

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000,
  expiration: 24 * 60 * 60 * 1000
});

app.use(session({
  name: 'jerung_studio.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite: process.env.SESSION_COOKIE_SAME_SITE || 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try { done(null, await getUserById(id)); }
  catch (error) { done(error); }
});
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (_accessToken, _refreshToken, profile, done) => {
  try { done(null, await findOrCreateGoogleUser(profile)); }
  catch (error) { done(error); }
}));

const googleLoginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDir),
  filename: (_req, _file, callback) => callback(null, `${crypto.randomUUID()}.incoming`)
});
const upload = multer({ storage, limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 } });

function requireAuth(req, res, next) {
  if (req.isAuthenticated?.() && req.user && !req.user.disabled) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

app.get('/health', async (_req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', service: 'jerung-studio-api', database: 'mysql', authentication: 'google-oauth' });
  } catch (error) { next(error); }
});

app.get('/auth/google', googleLoginLimiter, passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: true
}));
app.get('/auth/google/callback', googleLoginLimiter, (req, res, next) => {
  passport.authenticate('google', { failureRedirect: `${frontendUrl}/?login=failed` }, (error, user) => {
    if (error) return next(error);
    if (!user) return res.redirect(`${frontendUrl}/?login=failed`);
    req.logIn(user, loginError => {
      if (loginError) return next(loginError);
      return res.redirect(frontendUrl);
    });
  })(req, res, next);
});
app.get('/auth/me', (req, res) => {
  if (!req.isAuthenticated?.() || !req.user || req.user.disabled) return res.status(200).json({ user: null });
  res.json({ user: publicUser(req.user) });
});
app.post('/auth/logout', (req, res, next) => {
  req.logout(error => {
    if (error) return next(error);
    req.session.destroy(destroyError => {
      if (destroyError) return next(destroyError);
      res.clearCookie('jerung_studio.sid', {
        httpOnly: true,
        secure: isProduction,
        sameSite: process.env.SESSION_COOKIE_SAME_SITE || 'lax'
      });
      res.status(204).end();
    });
  });
});

app.post('/api/videos', requireAuth, (req, res, next) => {
  upload.single('video')(req, res, async error => {
    if (error) return next(error);
    try {
      if (!req.file) return res.status(400).json({ error: 'Upload one video using the video field.' });
      const id = await createJob(req.file, req.file.originalname, req.user.id);
      const row = await getUserJob(id, req.user.id);
      return res.status(202).json({ job: publicJob(row) });
    } catch (err) {
      if (req.file?.path) fs.rmSync(req.file.path, { force: true });
      return next(err);
    }
  });
});

app.get('/api/jobs/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await getUserJob(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Job not found' });
    res.json({ job: publicJob(row) });
  } catch (error) { next(error); }
});

app.get('/api/videos', requireAuth, async (req, res, next) => {
  try {
    const rows = await listCompletedJobs(req.user.id, 100);
    res.json({ videos: rows.map(publicJob) });
  } catch (error) { next(error); }
});

app.get('/api/videos/:id/download', requireAuth, async (req, res, next) => {
  try {
    const row = await getUserJob(req.params.id, req.user.id);
    if (!row || row.status !== 'completed' || !row.output_path || !fs.existsSync(row.output_path)) {
      return res.status(404).json({ error: 'Processed video not found' });
    }
    res.download(row.output_path, `${row.id}.mp4`);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Video exceeds the ${maxUploadMb} MB upload limit.` });
  }
  console.error(error);
  const status = error.status || 500;
  res.status(status).json({ error: status === 500 ? 'Server error' : error.message });
});

async function start() {
  await initDatabase();
  app.listen(port, host, () => {
    console.log(`JERUNG STUDIO API listening on http://${host}:${port} (MySQL + Google OAuth)`);
    recoverQueuedJobs().catch(error => console.error('Failed to recover queued jobs:', error));
  });
}
start().catch(error => {
  console.error('JERUNG STUDIO API startup failed:', error);
  process.exitCode = 1;
});
