import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseAdaptiveEncoding } from '../src/optimizer.js';

test('adaptive settings produce bounded CRF and frame structure controls', () => {
  const settings = chooseAdaptiveEncoding({
    width: 1920,
    height: 1080,
    avg_frame_rate: '30/1',
    bit_rate: '8000000',
    duration: '10'
  }, 10_000_000);

  assert.ok(settings.crf >= 16 && settings.crf <= 22);
  assert.equal(settings.maxGop, 60);
  assert.equal(settings.minGop, 15);
  assert.equal(settings.bFrames, 3);
  assert.equal(settings.sceneCut, 40);
});

test('higher frame rate produces a proportionally larger GOP ceiling', () => {
  const settings = chooseAdaptiveEncoding({
    width: 1280,
    height: 720,
    avg_frame_rate: '60/1',
    bit_rate: '5000000',
    duration: '10'
  }, 6_250_000);

  assert.equal(settings.maxGop, 120);
  assert.equal(settings.minGop, 30);
});
