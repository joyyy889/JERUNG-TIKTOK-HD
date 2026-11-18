import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRate, validatePreservedProperties } from '../src/optimizer.js';

test('parseRate handles rational frame rates', () => {
  assert.equal(parseRate('30000/1001'), 30000 / 1001);
  assert.equal(parseRate('30/1'), 30);
  assert.equal(parseRate('0/0'), null);
  assert.equal(parseRate(undefined), null);
});

test('preserved-property validator accepts unchanged video properties', () => {
  const before = {
    format: { duration: '10.0' },
    streams: [
      { codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1' },
      { codec_type: 'audio', codec_name: 'aac' }
    ]
  };
  const after = structuredClone(before);
  assert.deepEqual(validatePreservedProperties(before, after), {
    width: 1080, height: 1920, fps: 30, duration: 10
  });
});

test('preserved-property validator rejects changed resolution', () => {
  const before = {
    format: { duration: '10.0' },
    streams: [{ codec_type: 'video', width: 1080, height: 1920, avg_frame_rate: '30/1' }]
  };
  const after = {
    format: { duration: '10.0' },
    streams: [{ codec_type: 'video', width: 720, height: 1280, avg_frame_rate: '30/1' }]
  };
  assert.throws(() => validatePreservedProperties(before, after), /Resolution changed/);
});
