import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES || 150 * 1024 * 1024);
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 15 * 60 * 1000);
const ENCODE_MODE = (process.env.JERUNG_ENCODE_MODE || 'remux-first').toLowerCase();

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
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file
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
  if (!near(fpsA, fpsB, 0.01)) throw new Error(`Frame rate changed: ${fpsA} -> ${fpsB}`);
  if (audioStreams(before).length > 0 && audioStreams(after).length === 0) {
    throw new Error('Audio stream was lost');
  }
  if (!near(duration(before), duration(after), 0.25)) {
    throw new Error(`Duration changed: ${duration(before)}s -> ${duration(after)}s`);
  }
  return { width: b.width, height: b.height, fps: fpsB, duration: duration(after) };
}

/**
 * Select an initial x264 CRF and GOP ceiling from probed source characteristics.
 * CRF is a quality target, not a file-size target. The bounded heuristics are
 * deliberately conservative; they do not claim to infer the source's true
 * optimal quality. Users can override with JERUNG_CRF.
 */
export function chooseAdaptiveEncoding(video, sourceBytes) {
  const width = Number(video.width) || 0;
  const height = Number(video.height) || 0;
  const fps = parseRate(video.avg_frame_rate) ?? parseRate(video.r_frame_rate) ?? 30;
  const bitrate = Number(video.bit_rate) || (sourceBytes > 0 && Number(video.duration) > 0
    ? (sourceBytes * 8) / Number(video.duration)
    : 0);

  let crf = 19;
  const pixels = width * height;
  if (pixels >= 3840 * 2160) crf = 18;
  else if (pixels >= 2560 * 1440) crf = 18.5;
  else if (pixels >= 1920 * 1080) crf = 19;
  else crf = 20;

  // Do not force aggressive quality loss on already low-bitrate inputs.
  const bitsPerPixelFrame = bitrate > 0 && pixels > 0 && fps > 0
    ? bitrate / (pixels * fps)
    : null;
  if (bitsPerPixelFrame != null && bitsPerPixelFrame < 0.035) crf = Math.max(16, crf - 1.5);
  if (bitsPerPixelFrame != null && bitsPerPixelFrame > 0.16) crf = Math.min(22, crf + 1);

  const gopSeconds = 2;
  const maxGop = Math.max(12, Math.min(300, Math.round(fps * gopSeconds)));
  const minGop = Math.max(5, Math.min(maxGop, Math.round(fps * 0.5)));
  return {
    crf: Math.max(16, Math.min(22, Number(crf.toFixed(1)))),
    preset: process.env.JERUNG_X264_PRESET || 'medium',
    maxGop,
    minGop,
    bFrames: 3,
    sceneCut: 40,
    fps
  };
}

async function packetHashes(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-show_packets', '-show_data_hash', 'sha256',
    '-show_entries', 'packet=codec_type,data_hash', '-of', 'json', file
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 64 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return (parsed.packets ?? []).map(packet => `${packet.codec_type}:${packet.data_hash ?? 'missing'}`);
}

async function frameHashes(file) {
  const { stdout } = await run(FFMPEG, [
    '-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 64 * 1024 * 1024 });
  return stdout.split(/\r?\n/)
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
  if (!sameList(inputPackets, outputPackets)) throw new Error('Compressed packet hashes differ; stream-copy integrity check failed');
  if (!sameList(inputFrames, outputFrames)) throw new Error('Decoded frame hashes differ; visual-frame integrity check failed');
  return { packetHashesMatch: true, decodedFrameHashesMatch: true, videoFrameCount: inputFrames.length, packetCount: inputPackets.length };
}

function buildX264Args(settings) {
  const params = [
    `keyint=${settings.maxGop}`,
    `min-keyint=${settings.minGop}`,
    `scenecut=${settings.sceneCut}`,
    `bframes=${settings.bFrames}`,
    'open-gop=0',
    'rc-lookahead=40'
  ].join(':');
  return [
    '-c:v', 'libx264',
    '-preset', settings.preset,
    '-crf', String(settings.crf),
    '-bf', String(settings.bFrames),
    '-g', String(settings.maxGop),
    '-keyint_min', String(settings.minGop),
    '-sc_threshold', String(settings.sceneCut),
    '-x264-params', params
  ];
}

export async function encodeAdaptive(input, output, before, inputBytes) {
  const sourceVideo = primaryVideo(before);
  const settings = {
    ...chooseAdaptiveEncoding({ ...sourceVideo, duration: duration(before) }, inputBytes),
    ...(process.env.JERUNG_CRF ? { crf: Number(process.env.JERUNG_CRF) } : {})
  };
  if (!Number.isFinite(settings.crf) || settings.crf < 0 || settings.crf > 51) {
    throw new Error('JERUNG_CRF must be between 0 and 51');
  }
  const args = [
    '-hide_banner', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a?',
    '-map_metadata', '0', '-map_chapters', '0',
    ...buildX264Args(settings),
    '-pix_fmt', sourceVideo.pix_fmt || 'yuv420p',
    '-fps_mode', 'passthrough',
    '-c:a', 'copy',
    '-movflags', '+faststart',
    output
  ];
  await run(FFMPEG, args);
  const after = await probe(output);
  const properties = validatePreservedProperties(before, after);
  return {
    settings,
    properties,
    outputBytes: (await stat(output)).size,
    sourceBytes: inputBytes,
    sizeDeltaBytes: (await stat(output)).size - inputBytes,
    note: 'CRF targets visual quality; output size can be larger or smaller than source.'
  };
}

export async function optimizeVideo(input, output) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) throw new Error('Input and output paths must be different');
  if (!/\.(mp4|mov)$/i.test(inputPath)) throw new Error('Only MP4 and MOV input files are supported');
  if (!/\.mp4$/i.test(outputPath)) throw new Error('Output filename must end in .mp4');

  const inputStat = await stat(inputPath);
  if (inputStat.size > MAX_INPUT_BYTES) throw new Error(`Input exceeds limit of ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB`);
  await access(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });

  const before = await probe(inputPath);
  if (!primaryVideo(before)) throw new Error('Input contains no video stream');
  const tempPath = outputPath.replace(/\.mp4$/i, '.jerung-tmp.mp4');
  await rm(tempPath, { force: true });

  try {
    if (ENCODE_MODE === 'adaptive') {
      const encoded = await encodeAdaptive(inputPath, tempPath, before, inputStat.size);
      await rename(tempPath, outputPath);
      return {
        success: true,
        mode: 'adaptive-x264-reencode',
        output: outputPath,
        ...encoded
      };
    }

    // Default compatibility path: preserve original compressed video bitstream.
    const copyArgs = [
      '-hide_banner', '-y', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a?',
      '-map_metadata', '0', '-map_chapters', '0',
      '-c', 'copy', '-movflags', '+faststart', tempPath
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
      // A single controlled fallback if stream copy cannot be verified.
      const settings = chooseAdaptiveEncoding({ ...primaryVideo(before), duration: duration(before) }, inputStat.size);
      await run(FFMPEG, [
        '-hide_banner', '-y', '-i', inputPath,
        '-map', '0:v:0', '-map', '0:a?',
        '-map_metadata', '0', '-map_chapters', '0',
        ...buildX264Args(settings),
        '-pix_fmt', primaryVideo(before).pix_fmt || 'yuv420p',
        '-fps_mode', 'passthrough',
        '-c:a', 'copy', '-movflags', '+faststart', tempPath
      ]);
      const after = await probe(tempPath);
      const properties = validatePreservedProperties(before, after);
      await rename(tempPath, outputPath);
      return {
        success: true,
        mode: 'adaptive-x264-fallback',
        fallbackReason: copyError.message,
        output: outputPath,
        inputBytes: inputStat.size,
        outputBytes: (await stat(outputPath)).size,
        settings,
        properties,
        integrity: {
          packetHashesMatch: false,
          decodedFrameHashesMatch: 'not-applicable-after-re-encode',
          note: 'Re-encoding changes compressed frames; inspect output quality before publishing.'
        }
      };
    }
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
