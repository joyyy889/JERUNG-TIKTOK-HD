import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db, getJob, insertJob, updateJob } from './database.js';

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
const outputDir = path.resolve(process.env.OUTPUT_DIR || './data/outputs');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';
const concurrency = Math.max(1, Number(process.env.PROCESSING_CONCURRENCY || 1));
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

const queue = [];
let active = 0;
let pumping = false;

function run(command, args, timeoutMs = 60 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${path.basename(command)} timed out`));
    }, timeoutMs);
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-12000);
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (code ${code}): ${stderr.slice(-3000)}`));
    });
  });
}

export async function probe(filePath) {
  const { stdout } = await new Promise((resolve, reject) => {
    const child = spawn(ffprobe, [
      '-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk.toString(); });
    child.stderr.on('data', chunk => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout: out }) : reject(new Error(err || 'FFprobe could not read this video')));
  });
  const raw = JSON.parse(stdout);
  const video = raw.streams?.find(stream => stream.codec_type === 'video');
  if (!video) throw new Error('No video stream was detected in this file.');

  const audio = raw.streams?.filter(stream => stream.codec_type === 'audio') || [];
  return {
    container: raw.format?.format_name || null,
    formatLongName: raw.format?.format_long_name || null,
    durationSeconds: Number(raw.format?.duration || 0),
    sizeBytes: Number(raw.format?.size || 0),
    overallBitrate: Number(raw.format?.bit_rate || 0),
    video: {
      codec: video.codec_name || null,
      profile: video.profile || null,
      width: video.width || null,
      height: video.height || null,
      frameRate: video.avg_frame_rate || video.r_frame_rate || null,
      bitrate: Number(video.bit_rate || 0),
      pixelFormat: video.pix_fmt || null,
      colorRange: video.color_range || null,
      colorSpace: video.color_space || null,
      colorTransfer: video.color_transfer || null,
      colorPrimaries: video.color_primaries || null,
      rotation: video.tags?.rotate || null
    },
    audio: audio.map(stream => ({
      codec: stream.codec_name || null,
      profile: stream.profile || null,
      sampleRate: Number(stream.sample_rate || 0),
      channels: stream.channels || null,
      channelLayout: stream.channel_layout || null,
      bitrate: Number(stream.bit_rate || 0)
    })),
    metadata: raw.format?.tags || {}
  };
}

function isMp4Container(meta) {
  const brand = String(meta.metadata?.major_brand || '').toLowerCase();
  return Boolean(brand && (brand.startsWith('isom') || brand.startsWith('mp4') || brand.startsWith('iso') || brand.startsWith('avc1')));
}

const VIDEO_CODECS = new Set(['h264', 'hevc']);
const AUDIO_CODECS = new Set(['aac', 'mp3', 'alac']);

async function processJob(job) {
  const inputPath = job.input_path;
  const outputPath = path.join(outputDir, `${job.id}.mp4`);
  await updateJob(job.id, { status: 'processing', updated_at: new Date().toISOString() });

  try {
    const input = await probe(inputPath);
    const sourceCodec = input.video.codec;
    const targetCodec = VIDEO_CODECS.has(sourceCodec) ? sourceCodec : 'h264';
    const hasAudio = input.audio.length > 0;
    const audioCompatible = !hasAudio || input.audio.every(stream => AUDIO_CODECS.has(stream.codec));
    let mode;

    if (isMp4Container(input) && VIDEO_CODECS.has(sourceCodec) && audioCompatible) {
      await fs.promises.copyFile(inputPath, outputPath);
      mode = 'strict-pass-through';
    } else if (VIDEO_CODECS.has(sourceCodec)) {
      const args = [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0',
        '-sn', '-dn', '-c:v', 'copy'
      ];
      if (audioCompatible) args.push('-c:a', 'copy');
      else args.push('-c:a', 'aac', '-b:a', '192k');
      args.push('-movflags', '+faststart', outputPath);

      try {
        await run(ffmpeg, args);
        mode = audioCompatible ? 'remux' : 'remux-audio-convert';
      } catch {
        await fs.promises.rm(outputPath, { force: true });
        await encodeFallback(inputPath, outputPath, targetCodec, hasAudio);
        mode = 're-encode-fallback';
      }
    } else {
      await encodeFallback(inputPath, outputPath, 'h264', hasAudio);
      mode = 're-encode-h264';
    }

    const output = await probe(outputPath);
    if (!isMp4Container(output)) throw new Error('Output verification failed: output container is not confirmed as MP4.');
    if (!VIDEO_CODECS.has(output.video.codec)) throw new Error('Output verification failed: video codec must be H.264 or H.265.');
    if (output.audio.some(stream => !AUDIO_CODECS.has(stream.codec))) {
      throw new Error('Output verification failed: audio codec is not MP4-compatible.');
    }

    await updateJob(job.id, {
      status: 'completed',
      output_path: outputPath,
      processing_mode: mode,
      input_metadata: JSON.stringify(input),
      output_metadata: JSON.stringify(output),
      error_message: null,
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    await fs.promises.rm(outputPath, { force: true }).catch(() => {});
    await updateJob(job.id, {
      status: 'failed',
      error_message: String(error.message || error).slice(0, 2000),
      updated_at: new Date().toISOString()
    });
  } finally {
    await fs.promises.rm(inputPath, { force: true }).catch(() => {});
  }
}

async function encodeFallback(inputPath, outputPath, codec, hasAudio) {
  const encoder = codec === 'hevc' ? 'libx265' : 'libx264';
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a?', '-map_metadata', '0', '-map_chapters', '0',
    '-sn', '-dn', '-c:v', encoder
  ];
  if (codec === 'h264') args.push('-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  else args.push('-preset', 'medium', '-crf', '22', '-tag:v', 'hvc1');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outputPath);
  await run(ffmpeg, args);
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (active < concurrency && queue.length) {
      const id = queue.shift();
      const job = await getJob(id);
      if (!job || job.status !== 'queued') continue;
      active++;
      processJob(job).catch(error => {
        console.error(`Job ${id} processing failed:`, error);
      }).finally(() => {
        active--;
        pump();
      });
    }
  } catch (error) {
    console.error('Job queue database error:', error);
  } finally {
    pumping = false;
    if (active < concurrency && queue.length) queueMicrotask(pump);
  }
}

export function enqueue(id) {
  queue.push(id);
  pump();
}

export async function recoverQueuedJobs() {
  // A process restart may interrupt active jobs; return them to the durable queue.
  await db.execute(
    "UPDATE jobs SET status = 'queued', updated_at = ? WHERE status = 'processing'",
    [new Date().toISOString()]
  );
  const [rows] = await db.query("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC");
  for (const row of rows) queue.push(row.id);
  pump();
}

export async function createJob(file, originalName, userId) {
  const id = randomUUID();
  const inputPath = path.join(uploadDir, `${id}.upload`);
  const now = new Date().toISOString();
  fs.renameSync(file.path, inputPath);
  try {
    await insertJob({ id, userId, originalName, inputPath, now });
  } catch (error) {
    await fs.promises.rename(inputPath, file.path).catch(() => {});
    throw error;
  }
  enqueue(id);
  return id;
}
