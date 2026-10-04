'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  referenceVisualFingerprintV3FromRaw,
  validReferenceVisualFingerprintV3,
  compareReferenceVisualFingerprintsV3,
} = require('./verified_originals_production');

const WIDTH = 128;
const HEIGHT = 72;

function baseFrame(seed = 0) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const value =
        168 + Math.floor(x / 24) + Math.floor(y / 18) + seed;
      const offset = (y * WIDTH + x) * 3;
      frame[offset] = value;
      frame[offset + 1] = value;
      frame[offset + 2] = value;
    }
  }
  return frame;
}

function movingFrame(step) {
  const frame = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      frame[offset] = 68;
      frame[offset + 1] = 136;
      frame[offset + 2] = 204;
    }
  }

  const x0 = 40 + step * 2;
  for (let y = 34; y < 38; y += 1) {
    for (let x = x0; x < x0 + 5; x += 1) {
      const offset = (y * WIDTH + x) * 3;
      frame[offset] = 20;
      frame[offset + 1] = 20;
      frame[offset + 2] = 20;
    }
  }
  return frame;
}

function recompressedLike(frame) {
  const result = Buffer.from(frame);
  for (let i = 0; i < result.length; i += 1) {
    const noise = ((i * 31 + 11) % 3) - 1;
    result[i] = Math.max(0, Math.min(255, result[i] + noise));
  }
  return result;
}

const fingerprint = referenceVisualFingerprintV3FromRaw(baseFrame(), 'photo');
assert.strictEqual(validReferenceVisualFingerprintV3(fingerprint), true);
assert.strictEqual(fingerprint.frameCount, 1);
assert.strictEqual(fingerprint.algorithm, 'SIGILLUM_LOCAL_RGB_GRID_V3');
assert.strictEqual(fingerprint.featureBytesPerTile, 6);
assert.strictEqual(
  fingerprint.frames[0].globalHash,
  '03030f0f1f1f7f7f',
);
assert.strictEqual(
  crypto
    .createHash('sha256')
    .update(Buffer.from(fingerprint.frames[0].localFeatures, 'base64'))
    .digest('hex'),
  'f5df80936c5d9050b35e5a606c92b55a7eb2bec873f5805f9c81d37f14a4afbc',
);

const videoRaw = Buffer.concat([
  baseFrame(0),
  baseFrame(1),
  baseFrame(0),
]);
const videoFingerprint = referenceVisualFingerprintV3FromRaw(videoRaw, 'video');
assert.strictEqual(validReferenceVisualFingerprintV3(videoFingerprint), true);
assert.strictEqual(videoFingerprint.frameCount, 3);
assert.strictEqual(videoFingerprint.mediaType, 'video');

const shiftedExpectedFrames = Array.from(
  { length: 8 },
  (_, index) => movingFrame(index),
);
const shiftedCurrentFrames = [
  recompressedLike(shiftedExpectedFrames[0]),
  recompressedLike(shiftedExpectedFrames[0]),
  ...shiftedExpectedFrames.slice(1, 7).map(recompressedLike),
];
const shiftedExpected = referenceVisualFingerprintV3FromRaw(
  Buffer.concat(shiftedExpectedFrames),
  'video',
);
const shiftedCurrent = referenceVisualFingerprintV3FromRaw(
  Buffer.concat(shiftedCurrentFrames),
  'video',
);
const shiftedComparison = compareReferenceVisualFingerprintsV3(
  shiftedExpected,
  shiftedCurrent,
);
assert.strictEqual(shiftedComparison.verdict, 'conforming');
assert.strictEqual(shiftedComparison.modifiedFrames, 0);
assert.strictEqual(shiftedComparison.alignedFrames, 7);
assert.strictEqual(shiftedComparison.inconclusiveFrames, 1);

const malformed = { ...fingerprint, frames: [] };
assert.strictEqual(validReferenceVisualFingerprintV3(malformed), false);

console.log('reference visual fingerprint v3 tests passed');
