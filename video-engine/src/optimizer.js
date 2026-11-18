import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES || 150 * 1024 * 1024);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 15 * 60 * 1000);

export function run(command, args, { timeoutMs = TIMEOUT_MS, maxOutput = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const collect = (target, chunk) => {
      if (target === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > maxOutput) {
        child.kill('SIGKILL');
        finish(new Error(`${command} output exceeded safety limit`));
      }
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(`${command} exited with code ${code}: ${stderr.slice(-4000)}`));
    });

    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    }
  });
}

export async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_format',
    '-show_streams',
    '-of', 'json',
    file
  ]);
  return JSON.parse(stdout);
}

export function parseRate(value) {
  if (!value || value === '0/0') return null;
  const [n, d] = value.split('/').map(Number);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

function primaryVideo(info) {
  return info.streams?.find(stream => stream.codec_type === 'video') ?? null;
}
function audioStreams(info) {
  return (info.streams ?? []).filter(stream => stream.codec_type === 'audio');
}
function duration(info) {
  const value = Number(info.format?.duration);
  return Number.isFinite(value) ? value : null;
}
function near(a, b, tolerance) {
  return a == null || b == null || Math.abs(a - b) <= tolerance;
}

export function validatePreservedProperties(before, after) {
  const a = primaryVideo(before);
  const b = primaryVideo(after);
  if (!a || !b) throw new Error('Input or output has no video stream');
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Resolution changed: ${a.width}x${a.height} -> ${b.width}x${b.height}`);
  }
  const fpsA = parseRate(a.avg_frame_rate) ?? parseRate(a.r_frame_rate);
  const fpsB = parseRate(b.avg_frame_rate) ?? parseRate(b.r_frame_rate);
  if (!near(fpsA, fpsB, 0.01)) {
    throw new Error(`Frame rate changed: ${fpsA} -> ${fpsB}`);
  }
  if (audioStreams(before).length > 0 && audioStreams(after).length === 0) {
    throw new Error('Audio stream was lost');
  }
  if (!near(duration(before), duration(after), 0.25)) {
    throw new Error(`Duration changed: ${duration(before)}s -> ${duration(after)}s`);
  }
  return { width: b.width, height: b.height, fps: fpsB, duration: duration(after) };
}

async function packetHashes(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_packets',
    '-show_data_hash', 'sha256',
    '-show_entries', 'packet=codec_type,data_hash',
    '-of', 'json',
    file
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return (parsed.packets ?? []).map(packet => `${packet.codec_type}:${packet.data_hash ?? 'missing'}`);
}

async function frameHashes(file) {
  const { stdout, stderr } = await run(FFMPEG, [
    '-v', 'error', '-i', file,
    '-map', '0:v:0',
    '-f', 'framemd5', '-'
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 64 * 1024 * 1024 });
  const output = stdout || stderr;
  return output.split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').at(-1).trim())
    .filter(Boolean);
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function verifyStreamCopy(input, output, before, after) {
  validatePreservedProperties(before, after);
  const [inputPackets, outputPackets, inputFrames, outputFrames] = await Promise.all([
    packetHashes(input), packetHashes(output), frameHashes(input), frameHashes(output)
  ]);
  if (!sameList(inputPackets, outputPackets)) {
    throw new Error('Compressed packet hashes differ; stream-copy integrity check failed');
  }
  if (!sameList(inputFrames, outputFrames)) {
    throw new Error('Decoded frame hashes differ; visual-frame integrity check failed');
  }
  return {
    packetHashesMatch: true,
    decodedFrameHashesMatch: true,
    videoFrameCount: inputFrames.length,
    packetCount: inputPackets.length
  };
}

async function encoderAvailable(name) {
  try {
    const { stdout, stderr } = await run(FFMPEG, ['-hide_banner', '-encoders'], { timeoutMs: 15000 });
    return (stdout + stderr).includes(name);
  } catch {
    return false;
  }
}

async function buildFallbackArgs(input, output) {
  const useNvenc = process.env.JERUNG_USE_NVENC === '1' && await encoderAvailable('h264_nvenc');
  const videoArgs = useNvenc
    ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-rc', 'vbr', '-cq', '19', '-b:v', '0']
    : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18'];
  return [
    '-hide_banner', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a?',
    '-map_metadata', '0', '-map_chapters', '0',
    ...videoArgs,
    '-pix_fmt', 'yuv420p',
    '-fps_mode', 'passthrough',
    '-c:a', 'aac', '-b:a', '192k',
    '-movflags', '+faststart',
    output
  ];
}

export async function optimizeVideo(input, output) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) throw new Error('Input and output paths must be different');
  if (!/\.(mp4|mov)$/i.test(inputPath)) throw new Error('Only MP4 and MOV input files are supported');
  if (!/\.mp4$/i.test(outputPath)) throw new Error('Output filename must end in .mp4');

  const inputStat = await stat(inputPath);
  if (inputStat.size > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds limit of ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB`);
  }
  await access(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const before = await probe(inputPath);
  if (!primaryVideo(before)) throw new Error('Input contains no video stream');

  const tempPath = outputPath.replace(/\.mp4$/i, '.jerung-tmp.mp4');
  await rm(tempPath, { force: true });

  try {
    // RTX Fury-style "Original" path: rewrite the MP4 container only.
    // No video/audio encoder is invoked in this first pass.
    const copyArgs = [
      '-hide_banner', '-y', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-map_metadata', '0', '-map_chapters', '0',
      '-c', 'copy',
      '-movflags', '+faststart',
      tempPath
    ];

    try {
      await run(FFMPEG, copyArgs);
      const after = await probe(tempPath);
      const integrity = await verifyStreamCopy(inputPath, tempPath, before, after);
      await rename(tempPath, outputPath);
      return {
        success: true,
        mode: 'container-remux-stream-copy',
        output: outputPath,
        inputBytes: inputStat.size,
        outputBytes: (await stat(outputPath)).size,
        sourceVideoCodec: primaryVideo(before).codec_name,
        outputVideoCodec: primaryVideo(after).codec_name,
        properties: validatePreservedProperties(before, after),
        integrity
      };
    } catch (copyError) {
      await rm(tempPath, { force: true });
      // Single controlled fallback only. Never scale or deliberately change FPS.
      const fallbackArgs = await buildFallbackArgs(inputPath, tempPath);
      await run(FFMPEG, fallbackArgs);
      const after = await probe(tempPath);
      const properties = validatePreservedProperties(before, after);
      await rename(tempPath, outputPath);
      return {
        success: true,
        mode: 'single-pass-h264-fallback',
        fallbackReason: copyError.message,
        output: outputPath,
        inputBytes: inputStat.size,
        outputBytes: (await stat(outputPath)).size,
        sourceVideoCodec: primaryVideo(before).codec_name,
        outputVideoCodec: primaryVideo(after).codec_name,
        properties,
        integrity: {
          packetHashesMatch: false,
          decodedFrameHashesMatch: 'not-applicable-after-re-encode',
          note: 'Fallback re-encodes once; verify visual quality before publishing.'
        }
      };
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
