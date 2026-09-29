'use strict';

const assert = require('assert');
const crypto = require('crypto');
const {
  referenceVisualFingerprintV3FromRaw,
  validReferenceVisualFingerprintV3,
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

const malformed = { ...fingerprint, frames: [] };
assert.strictEqual(validReferenceVisualFingerprintV3(malformed), false);

console.log('reference visual fingerprint v3 tests passed');
