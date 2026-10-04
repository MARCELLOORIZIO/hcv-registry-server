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

function manualFrame(featureValue, globalHash) {
  return {
    globalHash,
    localFeatures: Buffer.alloc(16 * 9 * 6, featureValue).toString('base64'),
  };
}

function manualVideoFingerprint(frames) {
  return {
    type: 'SIGILLUM_REFERENCE_VISUAL_FINGERPRINT',
    version: 3,
    algorithm: 'SIGILLUM_LOCAL_RGB_GRID_V3',
    mediaType: 'video',
    width: 128,
    height: 72,
    gridColumns: 16,
    gridRows: 9,
    featureBytesPerTile: 6,
    samplingFps: 2,
    maxFrames: 120,
    frameCount: frames.length,
    frames,
  };
}

const misleadingExpected = manualVideoFingerprint([
  manualFrame(20, 'ffffffffffffffff'),
  manualFrame(80, '0000000000000000'),
  manualFrame(140, '0000000000000000'),
]);
const misleadingCurrent = manualVideoFingerprint([
  manualFrame(20, 'ffffffffffffffff'),
  manualFrame(80, '0000000000000001'),
  manualFrame(140, '0000000000000000'),
]);
const misleadingComparison = compareReferenceVisualFingerprintsV3(
  misleadingExpected,
  misleadingCurrent,
);
assert.strictEqual(misleadingComparison.verdict, 'conforming');
assert.strictEqual(misleadingComparison.alignedFrames, 3);
assert.strictEqual(misleadingComparison.modifiedFrames, 0);
assert.strictEqual(misleadingComparison.inconclusiveFrames, 0);

const malformed = { ...fingerprint, frames: [] };
assert.strictEqual(validReferenceVisualFingerprintV3(malformed), false);

console.log('reference visual fingerprint v3 tests passed');
