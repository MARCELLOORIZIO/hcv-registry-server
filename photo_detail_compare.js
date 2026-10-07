'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const WIDTH = 256;
const HEIGHT = 256;
const GRID_COLUMNS = 16;
const GRID_ROWS = 16;
const RGB_CHANNELS = 3;
const FRAME_BYTES = WIDTH * HEIGHT * RGB_CHANNELS;
const TILE_WIDTH = WIDTH / GRID_COLUMNS;
const TILE_HEIGHT = HEIGHT / GRID_ROWS;

const HIGH_DETAIL_WIDTH = 512;
const HIGH_DETAIL_HEIGHT = 512;
const FINE_GRID_COLUMNS = 64;
const FINE_GRID_ROWS = 64;
const FINE_TILE_WIDTH = HIGH_DETAIL_WIDTH / FINE_GRID_COLUMNS;
const FINE_TILE_HEIGHT = HIGH_DETAIL_HEIGHT / FINE_GRID_ROWS;
const FINE_FRAME_BYTES =
  HIGH_DETAIL_WIDTH * HIGH_DETAIL_HEIGHT * RGB_CHANNELS;

const HIGH_DIFFERENCE_PIXEL = 18.0;
const LOCALIZED_MEAN_THRESHOLD = 3.5;
const LOCALIZED_HIGH_RATIO_THRESHOLD = 0.06;
const STRONG_LOCALIZED_MEAN_THRESHOLD = 6.0;
const STRONG_LOCALIZED_HIGH_RATIO_THRESHOLD = 0.035;
const GLOBAL_MEAN_LUMA_MODIFIED_THRESHOLD = 6.0;
const GLOBAL_MEAN_RGB_MODIFIED_THRESHOLD = 8.0;
const CONFORMING_MEAN_LUMA_THRESHOLD = 3.0;
const CONFORMING_MEAN_RGB_THRESHOLD = 4.0;
const CONFORMING_MAX_TILE_MEAN_THRESHOLD = 3.5;
const CONFORMING_MAX_HIGH_RATIO_THRESHOLD = 0.06;

const FINE_HIGH_DIFFERENCE_PIXEL = 18.0;
const FINE_TILE_MEAN_THRESHOLD = 2.5;
const FINE_HIGH_RATIO_THRESHOLD = 0.03;
const FINE_MINIMUM_CLUSTER_TILES = 2;
const FINE_MAXIMUM_SUSPICIOUS_TILES = 32;

function rawLuma(rgb, width, height) {
  const raw = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * RGB_CHANNELS;
      raw[y * width + x] =
        0.2126 * rgb[offset] +
        0.7152 * rgb[offset + 1] +
        0.0722 * rgb[offset + 2];
    }
  }
  return raw;
}

function blurredLuma(rgb) {
  const raw = rawLuma(rgb, WIDTH, HEIGHT);
  const blurred = new Float64Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let sum = 0;
      let samples = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = Math.min(HEIGHT - 1, Math.max(0, y + dy));
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = Math.min(WIDTH - 1, Math.max(0, x + dx));
          sum += raw[yy * WIDTH + xx];
          samples += 1;
        }
      }
      blurred[y * WIDTH + x] = sum / samples;
    }
  }
  return blurred;
}

function inconclusiveComparison() {
  return {
    verdict: 'INCONCLUSIVE',
    meanLumaDifference: Number.POSITIVE_INFINITY,
    meanRgbDifference: Number.POSITIVE_INFINITY,
    maxTileMeanDifference: Number.POSITIVE_INFINITY,
    maxTileHighDifferenceRatio: 1,
    localizedTamperTiles: 0,
  };
}

function compareNormalizedRgb(expected, current) {
  if (!Buffer.isBuffer(expected) ||
      !Buffer.isBuffer(current) ||
      expected.length !== FRAME_BYTES ||
      current.length !== FRAME_BYTES) {
    return inconclusiveComparison();
  }

  const expectedLuma = blurredLuma(expected);
  const currentLuma = blurredLuma(current);

  let totalLumaDifference = 0;
  let totalRgbDifference = 0;
  for (let i = 0; i < expectedLuma.length; i += 1) {
    totalLumaDifference += Math.abs(expectedLuma[i] - currentLuma[i]);
  }
  for (let i = 0; i < FRAME_BYTES; i += 1) {
    totalRgbDifference += Math.abs(expected[i] - current[i]);
  }

  const meanLumaDifference = totalLumaDifference / expectedLuma.length;
  const meanRgbDifference = totalRgbDifference / FRAME_BYTES;

  let maxTileMeanDifference = 0;
  let maxTileHighDifferenceRatio = 0;
  let localizedTamperTiles = 0;

  for (let ty = 0; ty < GRID_ROWS; ty += 1) {
    for (let tx = 0; tx < GRID_COLUMNS; tx += 1) {
      let tileDifference = 0;
      let highDifferencePixels = 0;
      for (let y = ty * TILE_HEIGHT; y < (ty + 1) * TILE_HEIGHT; y += 1) {
        for (let x = tx * TILE_WIDTH; x < (tx + 1) * TILE_WIDTH; x += 1) {
          const index = y * WIDTH + x;
          const difference = Math.abs(expectedLuma[index] - currentLuma[index]);
          tileDifference += difference;
          if (difference >= HIGH_DIFFERENCE_PIXEL) highDifferencePixels += 1;
        }
      }

      const tilePixels = TILE_WIDTH * TILE_HEIGHT;
      const tileMeanDifference = tileDifference / tilePixels;
      const highDifferenceRatio = highDifferencePixels / tilePixels;
      maxTileMeanDifference = Math.max(
        maxTileMeanDifference,
        tileMeanDifference,
      );
      maxTileHighDifferenceRatio = Math.max(
        maxTileHighDifferenceRatio,
        highDifferenceRatio,
      );

      const localizedTamper =
        (tileMeanDifference >= LOCALIZED_MEAN_THRESHOLD &&
          highDifferenceRatio >= LOCALIZED_HIGH_RATIO_THRESHOLD) ||
        (tileMeanDifference >= STRONG_LOCALIZED_MEAN_THRESHOLD &&
          highDifferenceRatio >= STRONG_LOCALIZED_HIGH_RATIO_THRESHOLD);
      if (localizedTamper) localizedTamperTiles += 1;
    }
  }

  const globalTamper =
    meanLumaDifference > GLOBAL_MEAN_LUMA_MODIFIED_THRESHOLD ||
    meanRgbDifference > GLOBAL_MEAN_RGB_MODIFIED_THRESHOLD;

  if (globalTamper || localizedTamperTiles > 0) {
    return {
      verdict: 'MODIFIED',
      meanLumaDifference,
      meanRgbDifference,
      maxTileMeanDifference,
      maxTileHighDifferenceRatio,
      localizedTamperTiles,
    };
  }

  const clearlyConforming =
    meanLumaDifference <= CONFORMING_MEAN_LUMA_THRESHOLD &&
    meanRgbDifference <= CONFORMING_MEAN_RGB_THRESHOLD &&
    maxTileMeanDifference <= CONFORMING_MAX_TILE_MEAN_THRESHOLD &&
    maxTileHighDifferenceRatio < CONFORMING_MAX_HIGH_RATIO_THRESHOLD;

  return {
    verdict: clearlyConforming ? 'CONFORMING' : 'INCONCLUSIVE',
    meanLumaDifference,
    meanRgbDifference,
    maxTileMeanDifference,
    maxTileHighDifferenceRatio,
    localizedTamperTiles,
  };
}

function fineLocalizedEvidence(expected, current) {
  if (!Buffer.isBuffer(expected) ||
      !Buffer.isBuffer(current) ||
      expected.length !== FINE_FRAME_BYTES ||
      current.length !== FINE_FRAME_BYTES) {
    return {
      tampered: false,
      largestClusterTiles: 0,
      maxTileMeanDifference: 0,
      maxTileHighDifferenceRatio: 0,
    };
  }

  const expectedLuma = rawLuma(
    expected,
    HIGH_DETAIL_WIDTH,
    HIGH_DETAIL_HEIGHT,
  );
  const currentLuma = rawLuma(
    current,
    HIGH_DETAIL_WIDTH,
    HIGH_DETAIL_HEIGHT,
  );

  const suspicious = new Set();
  let maxTileMeanDifference = 0;
  let maxTileHighDifferenceRatio = 0;

  for (let ty = 0; ty < FINE_GRID_ROWS; ty += 1) {
    for (let tx = 0; tx < FINE_GRID_COLUMNS; tx += 1) {
      let tileDifference = 0;
      let highDifferencePixels = 0;
      for (let y = ty * FINE_TILE_HEIGHT;
        y < (ty + 1) * FINE_TILE_HEIGHT;
        y += 1) {
        for (let x = tx * FINE_TILE_WIDTH;
          x < (tx + 1) * FINE_TILE_WIDTH;
          x += 1) {
          const index = y * HIGH_DETAIL_WIDTH + x;
          const difference = Math.abs(expectedLuma[index] - currentLuma[index]);
          tileDifference += difference;
          if (difference >= FINE_HIGH_DIFFERENCE_PIXEL) {
            highDifferencePixels += 1;
          }
        }
      }

      const tilePixels = FINE_TILE_WIDTH * FINE_TILE_HEIGHT;
      const tileMeanDifference = tileDifference / tilePixels;
      const highDifferenceRatio = highDifferencePixels / tilePixels;
      maxTileMeanDifference = Math.max(
        maxTileMeanDifference,
        tileMeanDifference,
      );
      maxTileHighDifferenceRatio = Math.max(
        maxTileHighDifferenceRatio,
        highDifferenceRatio,
      );

      if (tileMeanDifference >= FINE_TILE_MEAN_THRESHOLD &&
          highDifferenceRatio >= FINE_HIGH_RATIO_THRESHOLD) {
        suspicious.add(ty * FINE_GRID_COLUMNS + tx);
      }
    }
  }

  if (suspicious.size < FINE_MINIMUM_CLUSTER_TILES ||
      suspicious.size > FINE_MAXIMUM_SUSPICIOUS_TILES) {
    return {
      tampered: false,
      largestClusterTiles: 0,
      maxTileMeanDifference,
      maxTileHighDifferenceRatio,
    };
  }

  const remaining = new Set(suspicious);
  let largestClusterTiles = 0;
  while (remaining.size) {
    const seed = remaining.values().next().value;
    const queue = [seed];
    remaining.delete(seed);
    let cluster = 0;

    while (queue.length) {
      const cell = queue.pop();
      cluster += 1;
      const cy = Math.floor(cell / FINE_GRID_COLUMNS);
      const cx = cell % FINE_GRID_COLUMNS;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const ny = cy + dy;
          const nx = cx + dx;
          if (ny < 0 || ny >= FINE_GRID_ROWS ||
              nx < 0 || nx >= FINE_GRID_COLUMNS) {
            continue;
          }
          const neighbor = ny * FINE_GRID_COLUMNS + nx;
          if (remaining.delete(neighbor)) queue.push(neighbor);
        }
      }
    }
    largestClusterTiles = Math.max(largestClusterTiles, cluster);
  }

  return {
    tampered: largestClusterTiles >= FINE_MINIMUM_CLUSTER_TILES,
    largestClusterTiles,
    maxTileMeanDifference,
    maxTileHighDifferenceRatio,
  };
}

async function normalizeRgb({
  ffmpegPath,
  inputPath,
  outputPath,
  width,
  height,
}) {
  await execFileAsync(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-y',
    '-i', inputPath,
    '-vf', `scale=${width}:${height},format=rgb24`,
    '-frames:v', '1',
    '-f', 'rawvideo',
    outputPath,
  ], {
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const bytes = await fs.promises.readFile(outputPath);
  const expectedBytes = width * height * RGB_CHANNELS;
  if (bytes.length !== expectedBytes) {
    throw new Error('PHOTO_DETAIL_RAW_SIZE_INVALID');
  }
  return bytes;
}

async function comparePhotoDetailFiles({
  ffmpegPath,
  expectedPath,
  currentPath,
  workDir,
}) {
  if (!ffmpegPath || !expectedPath || !currentPath || !workDir) {
    throw new Error('PHOTO_DETAIL_ARGUMENTS_INVALID');
  }

  const expectedCoarsePath = path.join(workDir, 'expected-256.raw');
  const currentCoarsePath = path.join(workDir, 'current-256.raw');
  const expectedFinePath = path.join(workDir, 'expected-512.raw');
  const currentFinePath = path.join(workDir, 'current-512.raw');

  try {
    const [expectedCoarse, currentCoarse] = await Promise.all([
      normalizeRgb({
        ffmpegPath,
        inputPath: expectedPath,
        outputPath: expectedCoarsePath,
        width: WIDTH,
        height: HEIGHT,
      }),
      normalizeRgb({
        ffmpegPath,
        inputPath: currentPath,
        outputPath: currentCoarsePath,
        width: WIDTH,
        height: HEIGHT,
      }),
    ]);
    const coarse = compareNormalizedRgb(expectedCoarse, currentCoarse);
    if (coarse.verdict === 'MODIFIED') return coarse;

    const [expectedFine, currentFine] = await Promise.all([
      normalizeRgb({
        ffmpegPath,
        inputPath: expectedPath,
        outputPath: expectedFinePath,
        width: HIGH_DETAIL_WIDTH,
        height: HIGH_DETAIL_HEIGHT,
      }),
      normalizeRgb({
        ffmpegPath,
        inputPath: currentPath,
        outputPath: currentFinePath,
        width: HIGH_DETAIL_WIDTH,
        height: HIGH_DETAIL_HEIGHT,
      }),
    ]);
    const fine = fineLocalizedEvidence(expectedFine, currentFine);
    if (!fine.tampered) return coarse;

    return {
      verdict: 'MODIFIED',
      meanLumaDifference: coarse.meanLumaDifference,
      meanRgbDifference: coarse.meanRgbDifference,
      maxTileMeanDifference: Math.max(
        coarse.maxTileMeanDifference,
        fine.maxTileMeanDifference,
      ),
      maxTileHighDifferenceRatio: Math.max(
        coarse.maxTileHighDifferenceRatio,
        fine.maxTileHighDifferenceRatio,
      ),
      localizedTamperTiles:
        coarse.localizedTamperTiles + fine.largestClusterTiles,
    };
  } finally {
    for (const filePath of [
      expectedCoarsePath,
      currentCoarsePath,
      expectedFinePath,
      currentFinePath,
    ]) {
      try { await fs.promises.rm(filePath, { force: true }); } catch (_) {}
    }
  }
}

module.exports = {
  FRAME_BYTES,
  FINE_FRAME_BYTES,
  compareNormalizedRgb,
  fineLocalizedEvidence,
  comparePhotoDetailFiles,
};
