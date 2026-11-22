import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { probe } from './src/optimizer.js';
import { rebuildGopVideo } from './src/gop-engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_BYTES = Number(process.env.MAX_INPUT_BYTES || 150 * 1024 * 1024);
const MAX_CONCURRENT = Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 1));
const RETENTION_MS = Math.max(5, Number(process.env.OUTPUT_RETENTION_MINUTES || 30)) * 60 * 1000;
const ACCESS_KEY = process.env.APP_ACCESS_KEY || '';
const WORK_DIR = process.env.WORK_DIR || path.join(os.tmpdir(), 'jerung-tiktok-hd');
const jobs = new Map();
let activeJobs = 0;

await mkdir(WORK_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, WORK_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}-upload${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.mp4', '.mov'].includes(ext)) return cb(new Error('Only MP4 and MOV files are accepted.'));
    cb(null, true);
  }
});

function requireAccess(req, res, next) {
  if (!ACCESS_KEY) return res.status(503).json({ error: 'Website access is not configured. Set APP_ACCESS_KEY in Railway Variables.' });
  const supplied = req.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (supplied.length !== ACCESS_KEY.length || supplied !== ACCESS_KEY) {
    return res.status(401).json({ error: 'Access key is incorrect.' });
  }
  next();
}

function summarize(info) {
  const video = info.streams?.find(stream => stream.codec_type === 'video');
  const audio = (info.streams || []).filter(stream => stream.codec_type === 'audio');
  return {
    format: info.format?.format_name ?? null,
    durationSeconds: Number(info.format?.duration) || null,
    sizeBytes: Number(info.format?.size) || null,
    bitrate: Number(info.format?.bit_rate) || null,
    video: video ? {
      codec: video.codec_name ?? null,
      profile: video.profile ?? null,
      width: video.width ?? null,
      height: video.height ?? null,
      fps: video.avg_frame_rate ?? null,
      pixelFormat: video.pix_fmt ?? null,
      bitDepth: video.bits_per_raw_sample ?? null,
      colorPrimaries: video.color_primaries ?? null,
      colorTransfer: video.color_transfer ?? null,
      colorSpace: video.color_space ?? null,
      colorRange: video.color_range ?? null,
      sampleAspectRatio: video.sample_aspect_ratio ?? null,
      displayAspectRatio: video.display_aspect_ratio ?? null,
      frameCount: video.nb_read_frames ?? video.nb_frames ?? null
    } : null,
    audio: audio.map(stream => ({
      codec: stream.codec_name ?? null,
      sampleRate: stream.sample_rate ?? null,
      channels: stream.channels ?? null,
      channelLayout: stream.channel_layout ?? null
    })),
    streamCount: info.streams?.length ?? 0
  };
}

function removeJob(id) {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  void Promise.all([
    rm(job.inputPath, { force: true }),
    rm(job.outputPath, { force: true })
  ]);
}

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'jerung-tiktok-hd-gop-test' }));
app.use('/api', requireAccess);

app.post('/api/process', (req, res) => {
  if (activeJobs >= MAX_CONCURRENT) {
    return res.status(429).json({ error: 'Server is busy processing another video. Please try again shortly.' });
  }
  activeJobs++;
  upload.single('video')(req, res, async error => {
    if (error) {
      activeJobs--;
      const status = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ error: error.message || 'Upload failed.' });
    }
    if (!req.file) {
      activeJobs--;
      return res.status(400).json({ error: 'Please select an MP4 or MOV file.' });
    }
    const id = randomUUID();
    const inputPath = req.file.path;
    const outputPath = path.join(WORK_DIR, `${id}-jerung-gop.mp4`);
    try {
      const sourceInfo = await probe(inputPath);
      const source = summarize(sourceInfo);
      const result = await rebuildGopVideo(inputPath, outputPath);
      const outputStat = await stat(outputPath);
      const outputInfo = await probe(outputPath);
      const output = summarize(outputInfo);
      jobs.set(id, { inputPath, outputPath, expiresAt: Date.now() + RETENTION_MS });
      setTimeout(() => removeJob(id), RETENTION_MS).unref?.();
      return res.json({
        success: true,
        jobId: id,
        source,
        output,
        processing: {
          mode: result.mode,
          settings: result.settings,
          frameTypes: result.frameTypes,
          gopComparison: result.gopComparison,
          inputBytes: result.inputBytes,
          outputBytes: outputStat.size,
          sizeDeltaBytes: outputStat.size - result.inputBytes,
          validation: result.properties
        },
        downloadUrl: `/api/download/${id}`,
        expiresInMinutes: Math.round(RETENTION_MS / 60000)
      });
    } catch (err) {
      await rm(inputPath, { force: true });
      await rm(outputPath, { force: true });
      return res.status(422).json({ error: err.message || 'Video processing failed.' });
    } finally {
      activeJobs--;
    }
  });
});

app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.expiresAt < Date.now()) {
    if (job) removeJob(req.params.id);
    return res.status(404).json({ error: 'Output expired or does not exist. Please process the video again.' });
  }
  return res.download(job.outputPath, 'jerung-tiktok-hd-gop.mp4');
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JERUNG TIKTOK HD test web listening on ${PORT}`);
  console.log(`Max upload: ${Math.round(MAX_BYTES / 1024 / 1024)} MB; concurrent jobs: ${MAX_CONCURRENT}`);
});
