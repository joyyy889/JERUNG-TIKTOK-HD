import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseRate, probe, run } from './optimizer.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_INPUT_BYTES = Number(process.env.MAX_INPUT_BYTES || 150 * 1024 * 1024);
const TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS || 15 * 60 * 1000);

function videoStreams(info) {
  return (info.streams ?? []).filter(stream => stream.codec_type === 'video');
}
function audioStreams(info) {
  return (info.streams ?? []).filter(stream => stream.codec_type === 'audio');
}
function streamRate(stream) {
  return parseRate(stream?.avg_frame_rate) ?? parseRate(stream?.r_frame_rate);
}
function numericDuration(info) {
  const value = Number(info.format?.duration);
  return Number.isFinite(value) ? value : null;
}
function audioLayout(info) {
  return audioStreams(info).map(stream => [
    stream.codec_name ?? null, stream.sample_rate ?? null,
    stream.channels ?? null, stream.channel_layout ?? null,
    stream.sample_fmt ?? null
  ]);
}

export function validateGopInput(info) {
  const videos = videoStreams(info);
  if (videos.length !== 1) {
    throw new Error(`GOP re-encode supports exactly one video stream; found ${videos.length}`);
  }
  const video = videos[0];
  if (video.codec_name !== 'h264') {
    throw new Error(`GOP re-encode currently supports H.264 input only; received ${video.codec_name ?? 'unknown'}`);
  }
  if (video.pix_fmt !== 'yuv420p') {
    throw new Error(`GOP re-encode currently supports 8-bit yuv420p only; received ${video.pix_fmt ?? 'unknown'}`);
  }
  const bits = Number(video.bits_per_raw_sample || 8);
  if (Number.isFinite(bits) && bits > 8) {
    throw new Error(`10-bit input is not supported by this GOP profile (detected ${bits}-bit)`);
  }
  const transfer = String(video.color_transfer ?? '').toLowerCase();
  if (['smpte2084', 'arib-std-b67'].includes(transfer)) {
    throw new Error('HDR PQ/HLG input is rejected to prevent accidental HDR-to-SDR conversion');
  }
  const unsupported = (info.streams ?? []).filter(stream =>
    !['video', 'audio'].includes(stream.codec_type)
  );
  if (unsupported.length) {
    throw new Error('Subtitle/data/attachment streams are not supported by this GOP profile; no output was created');
  }
  const fps = streamRate(video);
  if (!fps || !Number.isFinite(fps) || fps <= 0) {
    throw new Error('Cannot determine a reliable source frame rate for GOP configuration');
  }
  if (!video.width || !video.height) throw new Error('Source video dimensions are missing');
  return { video, fps, audioCount: audioStreams(info).length };
}

export function buildGopArgs({ input, output, source, gopSeconds = 2, bFrames = 3, crf = 18, preset = 'medium' }) {
  const { video, fps } = validateGopInput(source);
  if (!Number.isFinite(gopSeconds) || gopSeconds < 0.5 || gopSeconds > 10) {
    throw new Error('gopSeconds must be between 0.5 and 10');
  }
  if (!Number.isInteger(bFrames) || bFrames < 0 || bFrames > 8) {
    throw new Error('bFrames must be an integer between 0 and 8');
  }
  if (!Number.isInteger(crf) || crf < 0 || crf > 35) {
    throw new Error('CRF must be an integer between 0 and 35');
  }
  if (!['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'].includes(preset)) {
    throw new Error('Unsupported x264 preset');
  }
  const maxKeyint = Math.max(1, Math.round(fps * gopSeconds));
  const minKeyint = Math.max(1, Math.min(maxKeyint, Math.round(maxKeyint / 2)));
  const args = [
    '-hide_banner', '-y', '-i', input,
    '-map', '0:v:0', '-map', '0:a?',
    '-map_metadata', '0', '-map_chapters', '0',
    '-c:v', 'libx264', '-preset', preset, '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-fps_mode:v', 'passthrough',
    '-g', String(maxKeyint), '-keyint_min', String(minKeyint),
    '-sc_threshold', '40', '-bf', String(bFrames), '-b_strategy', '2',
    '-x264-params', 'open-gop=0',
    '-force_key_frames', `expr:gte(t,n_forced*${gopSeconds})`,
    '-c:a', 'copy',
    '-movflags', '+faststart',
    output
  ];
  for (const [field, option] of [['color_primaries', '-color_primaries'], ['color_transfer', '-color_trc'], ['color_space', '-colorspace'], ['color_range', '-color_range']]) {
    const value = video[field];
    if (value && value !== 'unknown' && value !== 'unspecified') args.splice(args.length - 1, 0, option, value);
  }
  return { args, settings: { fps, gopSeconds, maxKeyint, minKeyint, bFrames, crf, preset, width: video.width, height: video.height } };
}

async function countDecodedFrames(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=nb_read_frames', '-of', 'default=nokey=1:noprint_wrappers=1',
    file
  ], { timeoutMs: TIMEOUT_MS });
  const value = Number(stdout.trim());
  return Number.isFinite(value) ? value : null;
}

async function frameTypeSummary(file) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0', '-show_frames',
    '-show_entries', 'frame=pict_type,key_frame,best_effort_timestamp_time',
    '-of', 'json', file
  ], { timeoutMs: TIMEOUT_MS, maxOutput: 96 * 1024 * 1024 });
  const frames = JSON.parse(stdout).frames ?? [];
  const counts = { I: 0, P: 0, B: 0, other: 0 };
  const keyframes = [];
  for (let index = 0; index < frames.length; index++) {
    const type = frames[index].pict_type;
    if (type in counts) counts[type]++;
    else counts.other++;
    if (Number(frames[index].key_frame) === 1 || type === 'I') {
      keyframes.push({
        frame: index,
        time: frames[index].best_effort_timestamp_time ?? null
      });
    }
  }
  return { frameCount: frames.length, frameTypes: counts, keyframes };
}

function validateGopOutput(before, after, inputFrames, outputFrames) {
  const inputVideo = videoStreams(before)[0];
  const outputVideo = videoStreams(after)[0];
  if (!outputVideo) throw new Error('Encoded output contains no video stream');
  if (outputVideo.codec_name !== 'h264') throw new Error('Output codec is not H.264');
  if (inputVideo.width !== outputVideo.width || inputVideo.height !== outputVideo.height) {
    throw new Error('Resolution changed during GOP re-encode');
  }
  if (inputVideo.pix_fmt !== outputVideo.pix_fmt) throw new Error('Pixel format changed during GOP re-encode');
  for (const field of ['color_primaries', 'color_transfer', 'color_space', 'color_range']) {
    if ((inputVideo[field] ?? null) !== (outputVideo[field] ?? null)) {
      throw new Error(`Color/HDR signalling changed during GOP re-encode: ${field}`);
    }
  }
  if ((inputVideo.sample_aspect_ratio ?? null) !== (outputVideo.sample_aspect_ratio ?? null)) {
    throw new Error('Sample aspect ratio changed during GOP re-encode');
  }
  if ((inputVideo.display_aspect_ratio ?? null) !== (outputVideo.display_aspect_ratio ?? null)) {
    throw new Error('Display aspect ratio changed during GOP re-encode');
  }
  const inputFps = streamRate(inputVideo);
  const outputFps = streamRate(outputVideo);
  if (inputFps == null || outputFps == null || Math.abs(inputFps - outputFps) > 0.01) {
    throw new Error(`Frame rate changed during GOP re-encode: ${inputFps} -> ${outputFps}`);
  }
  const beforeDuration = numericDuration(before);
  const afterDuration = numericDuration(after);
  if (beforeDuration == null || afterDuration == null || Math.abs(beforeDuration - afterDuration) > 0.25) {
    throw new Error(`Duration changed during GOP re-encode: ${beforeDuration} -> ${afterDuration}`);
  }
  if (inputFrames == null || outputFrames == null || inputFrames !== outputFrames) {
    throw new Error(`Decoded frame count changed: ${inputFrames} -> ${outputFrames}`);
  }
  if (JSON.stringify(audioLayout(before)) !== JSON.stringify(audioLayout(after))) {
    throw new Error('Audio stream configuration changed; audio is expected to be stream-copied');
  }
  if (audioStreams(before).length !== audioStreams(after).length) {
    throw new Error('Audio stream count changed');
  }
  const inputAudio = audioStreams(before)[0];
  const outputAudio = audioStreams(after)[0];
  if (inputAudio && outputAudio) {
    const inputOffset = Number(inputAudio.start_time) - Number(inputVideo.start_time);
    const outputOffset = Number(outputAudio.start_time) - Number(outputVideo.start_time);
    if (Number.isFinite(inputOffset) && Number.isFinite(outputOffset) && Math.abs(inputOffset - outputOffset) > 0.05) {
      throw new Error(`Audio/video start offset changed: ${inputOffset} -> ${outputOffset}`);
    }
  }
  return {
    codec: outputVideo.codec_name,
    width: outputVideo.width,
    height: outputVideo.height,
    fps: outputFps,
    duration: afterDuration,
    frameCount: outputFrames,
    pixelFormat: outputVideo.pix_fmt,
    audioStreams: audioStreams(after).length
  };
}

export async function rebuildGopVideo(input, output, options = {}) {
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
  const inputConfig = validateGopInput(before);
  const inputFrames = await countDecodedFrames(inputPath);
  if (inputFrames == null) throw new Error('FFprobe could not count source video frames');
  const { args, settings } = buildGopArgs({
    input: inputPath, output: '', source: before, ...options
  });
  const tempPath = path.join(path.dirname(outputPath),
    `.${path.basename(outputPath, '.mp4')}-gop-${randomUUID()}.tmp.mp4`);
  args[args.length - 1] = tempPath;
  try {
    await run(FFMPEG, args, { timeoutMs: TIMEOUT_MS });
    const after = await probe(tempPath);
    const outputFrames = await countDecodedFrames(tempPath);
    const properties = validateGopOutput(before, after, inputFrames, outputFrames);
    const [sourceFrameTypes, frameTypes] = await Promise.all([
      frameTypeSummary(inputPath), frameTypeSummary(tempPath)
    ]);
    if (frameTypes.frameCount !== outputFrames) {
      throw new Error('FFprobe frame-type inspection count does not match decoded frame count');
    }
    await rename(tempPath, outputPath);
    const outputBytes = (await stat(outputPath)).size;
    return {
      success: true,
      mode: 'h264-gop-reencode',
      output: outputPath,
      inputBytes: inputStat.size,
      outputBytes,
      sizeDeltaBytes: outputBytes - inputStat.size,
      settings,
      properties,
      frameTypes,
      gopComparison: {
        source: sourceFrameTypes.frameTypes,
        output: frameTypes.frameTypes,
        keyframePositionsChanged: JSON.stringify(sourceFrameTypes.keyframes.map(item => item.frame)) !== JSON.stringify(frameTypes.keyframes.map(item => item.frame))
      },
      source: {
        codec: inputConfig.video.codec_name,
        fps: inputConfig.fps,
        frameCount: inputFrames
      },
      note: 'Video was re-encoded to create a new H.264 bitstream and GOP. Audio streams were copied.'
    };
  } catch (error) {
    await rm(tempPath, { force: true });
    throw new Error(`GOP re-encode failed validation; output was not published. ${error.message}`);
  }
}
