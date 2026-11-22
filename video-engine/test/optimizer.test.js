import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRate, validatePreservedProperties } from '../src/optimizer.js';

const sample = () => ({
  format: { duration: '10.0' },
  streams: [
    {
      codec_type: 'video', codec_name: 'h264', width: 1080, height: 1920,
      avg_frame_rate: '30000/1001', r_frame_rate: '30/1',
      pix_fmt: 'yuv420p', bits_per_raw_sample: '8', profile: 'High',
      color_primaries: 'bt709', color_transfer: 'bt709',
      color_space: 'bt709', color_range: 'tv'
    },
    {
      codec_type: 'audio', codec_name: 'aac', sample_rate: '48000',
      channels: 2, channel_layout: 'stereo', sample_fmt: 'fltp'
    }
  ]
});

test('parseRate handles rational frame rates and invalid values', () => {
  assert.equal(parseRate('30000/1001'), 30000 / 1001);
  assert.equal(parseRate('30/1'), 30);
  assert.equal(parseRate('0/0'), null);
  assert.equal(parseRate(undefined), null);
  assert.equal(parseRate('bad'), null);
});

test('validator accepts unchanged codec, image, color and audio properties', () => {
  const before = sample();
  const after = structuredClone(before);
  assert.deepEqual(validatePreservedProperties(before, after), {
    width: 1080, height: 1920, fps: 30000 / 1001, duration: 10,
    codec: 'h264', pixelFormat: 'yuv420p', colorPrimaries: 'bt709',
    colorTransfer: 'bt709', colorSpace: 'bt709', audioStreams: 1
  });
});

test('validator rejects changed resolution', () => {
  const before = sample();
  const after = sample();
  after.streams[0].width = 720;
  assert.throws(() => validatePreservedProperties(before, after), /Resolution changed/);
});

test('validator rejects codec changes', () => {
  const before = sample();
  const after = sample();
  after.streams[0].codec_name = 'hevc';
  assert.throws(() => validatePreservedProperties(before, after), /Video codec changed/);
});

test('validator rejects HDR/color or bit-depth signalling changes', () => {
  const before = sample();
  const after = sample();
  before.streams[0].color_transfer = 'smpte2084';
  after.streams[0].color_transfer = 'bt709';
  assert.throws(() => validatePreservedProperties(before, after), /color\/HDR signalling changed/);
});

test('validator rejects audio reconfiguration', () => {
  const before = sample();
  const after = sample();
  after.streams[1].sample_rate = '44100';
  assert.throws(() => validatePreservedProperties(before, after), /Audio stream properties changed/);
});

test('validator rejects missing audio', () => {
  const before = sample();
  const after = sample();
  after.streams = after.streams.filter(stream => stream.codec_type !== 'audio');
  assert.throws(() => validatePreservedProperties(before, after), /Audio stream properties changed/);
});
