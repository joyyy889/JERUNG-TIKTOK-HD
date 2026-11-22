import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGopArgs, validateGopInput } from '../src/gop-engine.js';

const source = () => ({
  format: { duration: '23.3' },
  streams: [{
    codec_type: 'video', codec_name: 'h264', profile: 'High',
    width: 512, height: 910, pix_fmt: 'yuv420p',
    avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709'
  }, {
    codec_type: 'audio', codec_name: 'aac', sample_rate: '44100',
    channels: 2, channel_layout: 'stereo', sample_fmt: 'fltp'
  }]
});

test('GOP profile sets new keyframe interval and B-frame structure', () => {
  const result = buildGopArgs({
    input: 'ori.mp4', output: 'out.mp4', source: source()
  });
  assert.equal(result.settings.maxKeyint, 60);
  assert.equal(result.settings.minKeyint, 30);
  assert.equal(result.settings.bFrames, 3);
  assert.ok(result.args.includes('libx264'));
  assert.ok(result.args.includes('-bf'));
  assert.ok(result.args.includes('3'));
  assert.ok(result.args.includes('-force_key_frames'));
  assert.ok(result.args.includes('-c:a'));
  assert.ok(result.args.includes('copy'));
});

test('GOP profile allows explicit GOP and B-frame tuning', () => {
  const result = buildGopArgs({
    input: 'ori.mp4', output: 'out.mp4', source: source(),
    gopSeconds: 1, bFrames: 2, crf: 19
  });
  assert.equal(result.settings.maxKeyint, 30);
  assert.equal(result.settings.bFrames, 2);
  assert.equal(result.settings.crf, 19);
});

test('GOP profile rejects HDR transfer characteristics', () => {
  const input = source();
  input.streams[0].color_transfer = 'smpte2084';
  assert.throws(() => validateGopInput(input), /HDR PQ\/HLG input is rejected/);
});

test('GOP profile rejects 10-bit or non-yuv420p input', () => {
  const input = source();
  input.streams[0].pix_fmt = 'yuv420p10le';
  assert.throws(() => validateGopInput(input), /8-bit yuv420p only/);
});

test('GOP profile rejects unsupported codec', () => {
  const input = source();
  input.streams[0].codec_name = 'hevc';
  assert.throws(() => validateGopInput(input), /H.264 input only/);
});

test('GOP profile rejects subtitle/data streams rather than silently dropping them', () => {
  const input = source();
  input.streams.push({ codec_type: 'subtitle', codec_name: 'mov_text' });
  assert.throws(() => validateGopInput(input), /Subtitle\/data\/attachment streams/);
});
