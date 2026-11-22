import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
      finish(new Error(\`${command} timed out after ${timeoutMs}ms\`));
    }, timeoutMs);

    const collect = (target, chunk) => {
      if (target === 'stdout') stdout += chunk.toString();
      else stderr += chunk.toString();
      if (stdout.length + stderr.length > maxOutput) {
        child.kill('SIGKILL');
        finish(new Error(\`${command} output exceeded safety limit\`));
      }
    };
    child.stdout.on('data', chunk => collect('stdout', chunk));
    child.stderr.on('data', chunk => collect('stderr', chunk));
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code === 0) finish(null, { stdout, stderr });
      else finish(new Error(\`${command} exited with code ${code}: ${stderr.slice(-4000)}\`));
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
function duration(info) {
  const value = Number(info.format?.duration);
  return Number.isFinite(value) ? value : null;
}
function near(a, b, tolerance) {
  return a == null || b == null || Math.abs(a - b) <= tolerance;
}
function colorSignature(stream) {
  return ['pix_fmt', 'bits_per_raw_sample', 'color_primaries', 'color_transfer',
    'color_space', 'color_range', 'profile'].map(key => stream?.[key] ?? null);
}
function audioSignature(info) {
  return (info.streams ?? []).filter(s => s.codec_type === 'audio').map(s => [
    s.codec_name ?? null, s.sample_rate ?? null, s.channels ?? null,
    s.channel_layout ?? null, s.sample_fmt ?? null
  ]);
}

export function validatePreservedProperties(before, after) {
  const a = primaryVideo(before);
  const b = primaryVideo(after);
  if (!a || !b) throw new Error('Input or output has no video stream');
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(\`Resolution changed: ${a.width}x${a.height} -> ${b.width}x${b.height}\`);
  }
  if (a.codec_name !== b.codec_name) throw new Error(\`Video codec changed: ${a.codec_name} -> ${b.codec_name}\`);
  if (JSON.stringify(colorSignature(a)) !== JSON.stringify(colorSignature(b))) {
    throw new Error('Pixel format, bit depth, profile or color/HDR signalling changed');
  }
  const fpsA = parseRate(a.avg_frame_rate) ?? parseRate(a.r_frame_rate);
  const fpsB = parseRate(b.avg_frame_rate) ?? parseRate(b.r_frame_rate);
  if (!near(fpsA, fpsB, 0.01)) throw new Error(\`Frame rate changed: ${fpsA} -> ${fpsB}\`);
  if (!near(duration(before), duration(after), 0.25)) {
    throw new Error(\`Duration changed: ${duration(before)}s -> ${duration(after)}s\`);
  }
  const audioA = audioSignature(before);
  const audioB = audioSignature(after);
  if (JSON.stringify(audioA) !== JSON.stringify(audioB)) {
    throw new Error('Audio stream properties changed');
  }
  const streamCounts = info => (info.streams ?? []).map(s => s.codec_type).sort();
  if (JSON.stringify(streamCounts(before)) !== JSON.stringify(streamCounts(after))) {
    throw new Error('Stream inventory changed');
  }
  return {
    width: b.width, height: b.height, fps: fpsB, duration: duration(after),
    codec: b.codec_name, pixelFormat: b.pix_fmt, colorPrimaries: b.color_primaries ?? null,
    colorTransfer: b.color_transfer ?? null, colorSpace: b.color_space ?? null,
    audioStreams: audioB.length
  };
}

async function packetHashes(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-show_packets', '-show_data_hash', 'sha256',
    '-show_entries', 'packet=stream_index,codec_type,data_hash,pts_time,dts_time,duration_time,flags',
    '-of', 'json', file
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 96 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  return (parsed.packets ?? []).map(packet =>
    \`${packet.stream_index}:${packet.codec_type}:${packet.data_hash ?? "missing"}\`
  );
}

async function frameHashes(file) {
  const { stdout } = await run(FFMPEG, [
    '-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 96 * 1024 * 1024 });
  return stdout.split(/\r?\n/)
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(',').at(-1).trim())
    .filter(Boolean);
}

function sameList(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function inspectPackets(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0', '-show_packets',
    '-show_entries', 'packet=pts_time,dts_time,duration_time,flags',
    '-of', 'json', file
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 64 * 1024 * 1024 });
  const packets = JSON.parse(stdout).packets ?? [];
  const keyframes = [];
  const durations = [];
  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    if (packet.flags?.includes('K')) keyframes.push(i);
    const value = Number(packet.duration_time);
    if (Number.isFinite(value) && value > 0) durations.push(value);
  }
  const uniqueDurations = [...new Set(durations.map(v => v.toFixed(6)))];
  return {
    videoPacketCount: packets.length,
    keyframePacketIndexes: keyframes,
    variablePacketDurations: uniqueDurations.length > 1,
    packetDurationSamples: uniqueDurations.slice(0, 12),
    timestampCoverage: packets.length > 0 && packets.every(p => p.pts_time != null && p.dts_time != null)
  };
}

export async function analyzeVideo(file) {
  const info = await probe(file);
  const video = primaryVideo(info);
  if (!video) throw new Error('Input contains no video stream');
  const packets = await inspectPackets(file);
  return {
    format: info.format?.format_name ?? null,
    duration: duration(info),
    video: {
      codec: video.codec_name, profile: video.profile ?? null,
      width: video.width, height: video.height,
      avgFrameRate: video.avg_frame_rate ?? null,
      realFrameRate: video.r_frame_rate ?? null,
      pixelFormat: video.pix_fmt ?? null,
      bitsPerRawSample: video.bits_per_raw_sample ?? null,
      colorPrimaries: video.color_primaries ?? null,
      colorTransfer: video.color_transfer ?? null,
      colorSpace: video.color_space ?? null,
      colorRange: video.color_range ?? null,
      sampleAspectRatio: video.sample_aspect_ratio ?? null,
      displayAspectRatio: video.display_aspect_ratio ?? null
    },
    audio: audioSignature(info),
    streamCount: info.streams?.length ?? 0,
    packets
  };
}

async function verifyStreamCopy(input, output, before, after) {
  const properties = validatePreservedProperties(before, after);
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
    packetHashesMatch: true, decodedFrameHashesMatch: true,
    videoFrameCount: inputFrames.length, packetCount: inputPackets.length, properties
  };
}

export async function optimizeVideo(input, output) {
  const inputPath = path.resolve(input);
  const outputPath = path.resolve(output);
  if (inputPath === outputPath) throw new Error('Input and output paths must be different');
  if (!/\.(mp4|mov)$/i.test(inputPath)) throw new Error('Only MP4 and MOV input files are supported');
  if (!/\.mp4$/i.test(outputPath)) throw new Error('Output filename must end in .mp4');
  const inputStat = await stat(inputPath);
  if (inputStat.size > MAX_INPUT_BYTES) {
    throw new Error(\`Input exceeds limit of ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} MB\`);
  }
  await access(inputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const before = await probe(inputPath);
  if (!primaryVideo(before)) throw new Error('Input contains no video stream');
  const tempPath = path.join(path.dirname(outputPath),
    \`.${path.basename(outputPath, ".mp4")}-${randomUUID()}-tmp.mp4\`);

  try {
    // Safe baseline: preserve every stream and never silently transcode.
    await run(FFMPEG, [
      '-hide_banner', '-y', '-i', inputPath, '-map', '0',
      '-map_metadata', '0', '-map_chapters', '0',
      '-c', 'copy', '-movflags', '+faststart', tempPath
    ]);
    const after = await probe(tempPath);
    const integrity = await verifyStreamCopy(inputPath, tempPath, before, after);
    await rename(tempPath, outputPath);
    return {
      success: true, mode: 'verified-stream-copy-remux',
      output: outputPath, inputBytes: inputStat.size,
      outputBytes: (await stat(outputPath)).size,
      sourceVideoCodec: primaryVideo(before).codec_name,
      outputVideoCodec: primaryVideo(after).codec_name,
      properties: integrity.properties, integrity,
      note: 'No video or audio re-encoding was performed.'
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new Error(\`Safe remux was not verified; no re-encode was attempted. ${error.message}\`);
  }
}
