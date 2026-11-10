import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || ffprobeStatic?.path || 'ffprobe';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

async function probe(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file
  ]);
  return JSON.parse(stdout);
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf']);

function inspectBoxes(buffer, start = 0, end = buffer.length, parent = '') {
  const found = [];
  let offset = start;

  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;

    if (size === 1) {
      if (offset + 16 > end) break;
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(largeSize);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;

    const entry = { type, parent, offset, size };
    if (type === 'stts' && size >= headerSize + 8) {
      const payload = offset + headerSize;
      entry.entryCount = buffer.readUInt32BE(payload + 4);
    }
    if (type === 'stsc' && size >= headerSize + 8) {
      const payload = offset + headerSize;
      entry.entryCount = buffer.readUInt32BE(payload + 4);
    }
    found.push(entry);

    if (CONTAINERS.has(type)) {
      const childStart = offset + headerSize + (type === 'meta' ? 4 : 0);
      found.push(...inspectBoxes(buffer, childStart, offset + size, type));
    }
    offset += size;
  }
  return found;
}

async function createCopy(input, output, faststart) {
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-map', '0',
    '-c', 'copy',
    '-map_metadata', '0',
    '-movflags', faststart ? '+faststart' : '0',
    '-f', 'mp4',
    output
  ];
  await run(FFMPEG, args);
}

function streamSummary(probeResult) {
  return (probeResult.streams || []).map(stream => ({
    index: stream.index,
    type: stream.codec_type,
    codec: stream.codec_name,
    profile: stream.profile,
    width: stream.width,
    height: stream.height,
    duration: stream.duration,
    time_base: stream.time_base,
    frame_rate: stream.avg_frame_rate
  }));
}

async function inspectOutput(file) {
  const [metadata, buffer, info] = await Promise.all([
    probe(file),
    readFile(file),
    stat(file)
  ]);
  const boxes = inspectBoxes(buffer);
  return {
    file: path.basename(file),
    size_bytes: info.size,
    format: metadata.format?.format_name,
    duration: metadata.format?.duration,
    streams: streamSummary(metadata),
    sample_tables: boxes
      .filter(box => box.type === 'stts' || box.type === 'stsc')
      .map(({ type, parent, offset, size, entryCount }) => ({
        type, parent, offset, size, entry_count: entryCount
      })),
    top_level_boxes: boxes.filter(box => !box.parent).map(box => box.type)
  };
}

async function main() {
  const input = process.argv[2];
  const outputDir = process.argv[3] || 'mp4-test-output';
  if (!input) {
    console.error('Usage: node mp4-test-engine.js <input.mp4|input.mov> [output-dir]');
    process.exitCode = 2;
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const baseline = path.join(outputDir, 'output-1-copy-reference.mp4');
  const faststart = path.join(outputDir, 'output-2-copy-faststart-reference.mp4');

  await createCopy(input, baseline, false);
  await createCopy(input, faststart, true);

  const report = {
    generated_at: new Date().toISOString(),
    note: 'Safe copy-only reference tests. These files are ordinary MP4s and are not designed to be unplayable or restricted to Google Drive.',
    input: await inspectOutput(input),
    output_1_reference: await inspectOutput(baseline),
    output_2_reference: await inspectOutput(faststart)
  };

  const reportPath = path.join(outputDir, 'mp4-test-report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportPath, outputs: [baseline, faststart] }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
