'use strict';

const assert = require('assert');
const {
  FRAME_BYTES,
  FINE_FRAME_BYTES,
  compareNormalizedRgb,
  fineLocalizedEvidence,
} = require('./photo_detail_compare');

{
  const original = Buffer.alloc(FRAME_BYTES, 120);
  const copy = Buffer.from(original);
  const result = compareNormalizedRgb(original, copy);
  assert.strictEqual(result.verdict, 'CONFORMING');
  assert.strictEqual(result.meanLumaDifference, 0);
  assert.strictEqual(result.meanRgbDifference, 0);
}

{
  const original = Buffer.alloc(FRAME_BYTES, 0);
  const changed = Buffer.alloc(FRAME_BYTES, 255);
  const result = compareNormalizedRgb(original, changed);
  assert.strictEqual(result.verdict, 'MODIFIED');
  assert(result.meanLumaDifference > 6);
  assert(result.meanRgbDifference > 8);
}

{
  const result = compareNormalizedRgb(Buffer.alloc(10), Buffer.alloc(10));
  assert.strictEqual(result.verdict, 'INCONCLUSIVE');
}

{
  const original = Buffer.alloc(FINE_FRAME_BYTES, 0);
  const changed = Buffer.from(original);
  const width = 512;
  const channels = 3;

  for (const tileX of [10, 11]) {
    const tileY = 10;
    for (let y = tileY * 8; y < (tileY + 1) * 8; y += 1) {
      for (let x = tileX * 8; x < (tileX + 1) * 8; x += 1) {
        const offset = (y * width + x) * channels;
        changed[offset] = 30;
        changed[offset + 1] = 30;
        changed[offset + 2] = 30;
      }
    }
  }

  const fine = fineLocalizedEvidence(original, changed);
  assert.strictEqual(fine.tampered, true);
  assert(fine.largestClusterTiles >= 2);
}

console.log('photo_detail_compare_test: PASS');
