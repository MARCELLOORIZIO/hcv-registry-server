'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const { pipeline } = require('stream/promises');
const {
  createR2ReferenceProvider,
  opaqueObjectKey,
  selectPrimaryReferenceProvider,
} = require('./primary_reference_provider');
const {
  availableReference: availablePrimaryReference,
  claimDeleteJob,
  claimDeleteJobs,
  claimUploadJob,
  createOrGetReferenceJob,
  initPrimaryReferenceLifecycleSchema,
  markCommitted: markPrimaryReferenceCommitted,
  markDeleteRetry,
  markDeleted: markPrimaryReferenceDeleted,
  markUploadRetry,
  referenceJobByProviderObject,
  requestDeleteByProviderObject,
} = require('./primary_reference_lifecycle');
const {
  OPERATION: PRIMARY_REFERENCE_OPERATION,
  SCHEMA: PRIMARY_REFERENCE_SCHEMA,
  createPrimaryReferenceManifest,
  verifyPrimaryReferenceManifest,
} = require('./primary_reference_manifest');
const {
  consumeReadAuthorization,
  initPrimaryReferenceReadAuthSchema,
  issueReadAuthorization,
} = require('./primary_reference_read_auth');

const execFileAsync = promisify(execFile);

const HCV_ID = /^HCV-[A-F0-9]{16}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const DERIVATION_SCHEMA = 'SIGILLUM_TRUSTED_DERIVATION_V1';
const DERIVATION_OPERATION = 'video_transcode_h264_aac_v1';
const PHOTO_DERIVATION_OPERATION = 'photo_to_reference_video_v1';
const SUBTITLE_DERIVATION_SCHEMA = 'SIGILLUM_SUBTITLE_DERIVATION_V1';
const SUBTITLE_DERIVATION_OPERATION = 'subtitle_burn_in_reference_v1';
const ORIGINAL_REFERENCE_ROLE = 'ORIGINAL_REFERENCE';
const DERIVED_REFERENCE_ROLE = 'DERIVED_REFERENCE';
const CAPTURE_PROVENANCE_TYPE = 'SIGILLUM_CAPTURE_PROVENANCE_BINDING';
const CAPTURE_PROVENANCE_PIPELINE = 'HCV_CAPTURE_BINDING_V1';
const DERIVATION_SIGNATURE_ALGORITHM = 'RSA-SHA256-PKCS1V15';
const CONSENT_VERSION = 'SIGILLUM_VERIFIED_ORIGINALS_CONSENT_2026-09-25_V2';
const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const REFERENCE_VISUAL_FINGERPRINT_TYPE = 'SIGILLUM_REFERENCE_VISUAL_FINGERPRINT';
const REFERENCE_VISUAL_FINGERPRINT_VERSION = 3;
const REFERENCE_VISUAL_FINGERPRINT_ALGORITHM = 'SIGILLUM_LOCAL_RGB_GRID_V3';
const REFERENCE_VISUAL_WIDTH = 128;
const REFERENCE_VISUAL_HEIGHT = 72;
const REFERENCE_VISUAL_GRID_COLUMNS = 16;
const REFERENCE_VISUAL_GRID_ROWS = 9;
const REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE = 6;
const REFERENCE_VISUAL_RGB_CHANNELS = 3;
const REFERENCE_VISUAL_VIDEO_FPS = 2;
const REFERENCE_VISUAL_MAX_VIDEO_FRAMES = 120;
const REFERENCE_VISUAL_FRAME_BYTES =
  REFERENCE_VISUAL_WIDTH *
  REFERENCE_VISUAL_HEIGHT *
  REFERENCE_VISUAL_RGB_CHANNELS;
const REFERENCE_VISUAL_TILE_WIDTH =
  REFERENCE_VISUAL_WIDTH / REFERENCE_VISUAL_GRID_COLUMNS;
const REFERENCE_VISUAL_TILE_HEIGHT =
  REFERENCE_VISUAL_HEIGHT / REFERENCE_VISUAL_GRID_ROWS;
const REFERENCE_VISUAL_MAX_MEAN_LUMA_DIFFERENCE = 6.0;
const REFERENCE_VISUAL_MAX_SINGLE_TILE_LUMA_DIFFERENCE = 18.0;
const REFERENCE_VISUAL_MAX_MEAN_CHROMA_DIFFERENCE = 8.0;
const REFERENCE_VISUAL_MAX_MEAN_RGB_DIFFERENCE = 8.0;

function hashBytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashString(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function referenceVisualLumaV3(red, green, blue) {
  return Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
}

function referenceVisualFrameV3(frame) {
  if (!Buffer.isBuffer(frame) || frame.length !== REFERENCE_VISUAL_FRAME_BYTES) {
    throw new Error('REFERENCE_VISUAL_V3_FRAME_SIZE_INVALID');
  }
  const local = Buffer.alloc(
    REFERENCE_VISUAL_GRID_COLUMNS *
      REFERENCE_VISUAL_GRID_ROWS *
      REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE,
  );
  let out = 0;

  for (let ty = 0; ty < REFERENCE_VISUAL_GRID_ROWS; ty += 1) {
    for (let tx = 0; tx < REFERENCE_VISUAL_GRID_COLUMNS; tx += 1) {
      let sumLuma = 0;
      let sumRed = 0;
      let sumGreen = 0;
      let sumBlue = 0;
      let minimumLuma = 255;
      let maximumLuma = 0;
      let gradient = 0;
      let gradientCount = 0;
      const x0 = tx * REFERENCE_VISUAL_TILE_WIDTH;
      const y0 = ty * REFERENCE_VISUAL_TILE_HEIGHT;

      for (let y = y0; y < y0 + REFERENCE_VISUAL_TILE_HEIGHT; y += 1) {
        for (let x = x0; x < x0 + REFERENCE_VISUAL_TILE_WIDTH; x += 1) {
          const offset =
            (y * REFERENCE_VISUAL_WIDTH + x) * REFERENCE_VISUAL_RGB_CHANNELS;
          const red = frame[offset];
          const green = frame[offset + 1];
          const blue = frame[offset + 2];
          const value = referenceVisualLumaV3(red, green, blue);

          sumLuma += value;
          sumRed += red;
          sumGreen += green;
          sumBlue += blue;
          minimumLuma = Math.min(minimumLuma, value);
          maximumLuma = Math.max(maximumLuma, value);

          if (x + 1 < x0 + REFERENCE_VISUAL_TILE_WIDTH) {
            const right = offset + REFERENCE_VISUAL_RGB_CHANNELS;
            gradient += Math.abs(
              value -
                referenceVisualLumaV3(
                  frame[right],
                  frame[right + 1],
                  frame[right + 2],
                ),
            );
            gradientCount += 1;
          }
          if (y + 1 < y0 + REFERENCE_VISUAL_TILE_HEIGHT) {
            const below =
              ((y + 1) * REFERENCE_VISUAL_WIDTH + x) *
              REFERENCE_VISUAL_RGB_CHANNELS;
            gradient += Math.abs(
              value -
                referenceVisualLumaV3(
                  frame[below],
                  frame[below + 1],
                  frame[below + 2],
                ),
            );
            gradientCount += 1;
          }
        }
      }

      const pixels =
        REFERENCE_VISUAL_TILE_WIDTH * REFERENCE_VISUAL_TILE_HEIGHT;
      local[out++] = Math.round(sumLuma / pixels);
      local[out++] = maximumLuma - minimumLuma;
      local[out++] = gradientCount ? Math.round(gradient / gradientCount) : 0;
      local[out++] = Math.round(sumRed / pixels);
      local[out++] = Math.round(sumGreen / pixels);
      local[out++] = Math.round(sumBlue / pixels);
    }
  }

  const macroMeans = [];
  for (let my = 0; my < 8; my += 1) {
    for (let mx = 0; mx < 8; mx += 1) {
      let sum = 0;
      for (let y = my * 9; y < (my + 1) * 9; y += 1) {
        for (let x = mx * 16; x < (mx + 1) * 16; x += 1) {
          const offset =
            (y * REFERENCE_VISUAL_WIDTH + x) * REFERENCE_VISUAL_RGB_CHANNELS;
          sum += referenceVisualLumaV3(
            frame[offset],
            frame[offset + 1],
            frame[offset + 2],
          );
        }
      }
      macroMeans.push(Math.round(sum / (16 * 9)));
    }
  }

  const globalMean =
    macroMeans.reduce((total, value) => total + value, 0) / macroMeans.length;
  let bits = 0n;
  for (const value of macroMeans) {
    bits = (bits << 1n) | (value >= globalMean ? 1n : 0n);
  }

  return {
    globalHash: bits.toString(16).padStart(16, '0'),
    localFeatures: local.toString('base64'),
  };
}

function referenceVisualFingerprintV3FromRaw(raw, mediaType) {
  if (!Buffer.isBuffer(raw) ||
      !raw.length ||
      raw.length % REFERENCE_VISUAL_FRAME_BYTES !== 0 ||
      (mediaType !== 'photo' && mediaType !== 'video')) {
    throw new Error('REFERENCE_VISUAL_V3_RAW_INVALID');
  }
  const rawFrameCount = raw.length / REFERENCE_VISUAL_FRAME_BYTES;
  const frameCount = mediaType === 'photo'
    ? 1
    : Math.min(rawFrameCount, REFERENCE_VISUAL_MAX_VIDEO_FRAMES);
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const start = index * REFERENCE_VISUAL_FRAME_BYTES;
    frames.push(
      referenceVisualFrameV3(
        raw.subarray(start, start + REFERENCE_VISUAL_FRAME_BYTES),
      ),
    );
  }
  return {
    type: REFERENCE_VISUAL_FINGERPRINT_TYPE,
    version: REFERENCE_VISUAL_FINGERPRINT_VERSION,
    algorithm: REFERENCE_VISUAL_FINGERPRINT_ALGORITHM,
    mediaType,
    width: REFERENCE_VISUAL_WIDTH,
    height: REFERENCE_VISUAL_HEIGHT,
    gridColumns: REFERENCE_VISUAL_GRID_COLUMNS,
    gridRows: REFERENCE_VISUAL_GRID_ROWS,
    featureBytesPerTile: REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE,
    samplingFps: mediaType === 'video' ? REFERENCE_VISUAL_VIDEO_FPS : 0,
    maxFrames: mediaType === 'video' ? REFERENCE_VISUAL_MAX_VIDEO_FRAMES : 1,
    frameCount: frames.length,
    frames,
  };
}

function validReferenceVisualFingerprintV3(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      raw.type !== REFERENCE_VISUAL_FINGERPRINT_TYPE ||
      raw.version !== REFERENCE_VISUAL_FINGERPRINT_VERSION ||
      raw.algorithm !== REFERENCE_VISUAL_FINGERPRINT_ALGORITHM ||
      raw.width !== REFERENCE_VISUAL_WIDTH ||
      raw.height !== REFERENCE_VISUAL_HEIGHT ||
      raw.gridColumns !== REFERENCE_VISUAL_GRID_COLUMNS ||
      raw.gridRows !== REFERENCE_VISUAL_GRID_ROWS ||
      raw.featureBytesPerTile !== REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE ||
      (raw.mediaType !== 'photo' && raw.mediaType !== 'video') ||
      !Array.isArray(raw.frames) ||
      !raw.frames.length ||
      raw.frameCount !== raw.frames.length ||
      raw.frames.length > REFERENCE_VISUAL_MAX_VIDEO_FRAMES) {
    return false;
  }
  if (raw.mediaType === 'photo' && raw.frames.length !== 1) return false;
  const expectedFeatureBytes =
    REFERENCE_VISUAL_GRID_COLUMNS *
    REFERENCE_VISUAL_GRID_ROWS *
    REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE;
  return raw.frames.every(frame => {
    if (!frame || typeof frame !== 'object' ||
        !/^[a-f0-9]{16}$/.test(String(frame.globalHash || ''))) {
      return false;
    }
    try {
      return Buffer.from(
        String(frame.localFeatures || ''),
        'base64',
      ).length === expectedFeatureBytes;
    } catch (_) {
      return false;
    }
  });
}

function referenceVisualHexDistanceV3(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a.length !== b.length) return 9999;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = Number.parseInt(a[index], 16);
    const bv = Number.parseInt(b[index], 16);
    if (!Number.isInteger(av) || !Number.isInteger(bv)) return 9999;
    let diff = av ^ bv;
    while (diff !== 0) {
      distance += diff & 1;
      diff >>= 1;
    }
  }
  return distance;
}

function compareReferenceVisualFrameV3(expected, current) {
  const globalDistance = referenceVisualHexDistanceV3(
    expected?.globalHash,
    current?.globalHash,
  );
  if (globalDistance > 18) {
    return { comparable: false, tampered: false };
  }

  let left;
  let right;
  try {
    left = Buffer.from(String(expected?.localFeatures || ''), 'base64');
    right = Buffer.from(String(current?.localFeatures || ''), 'base64');
  } catch (_) {
    return { comparable: false, tampered: false };
  }

  const expectedLength =
    REFERENCE_VISUAL_GRID_COLUMNS *
    REFERENCE_VISUAL_GRID_ROWS *
    REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE;
  if (left.length !== right.length || left.length !== expectedLength) {
    return { comparable: false, tampered: false };
  }

  let totalMeanDifference = 0;
  let totalLumaDifference = 0;
  let maximumLumaDifference = 0;
  let totalChromaDifference = 0;
  let totalRgbDifference = 0;
  let severeCount = 0;
  const moderate = new Set();
  const tileCount = REFERENCE_VISUAL_GRID_COLUMNS * REFERENCE_VISUAL_GRID_ROWS;

  for (let tile = 0; tile < tileCount; tile += 1) {
    const offset = tile * REFERENCE_VISUAL_FEATURE_BYTES_PER_TILE;
    const expectedMean = left[offset];
    const expectedRange = left[offset + 1];
    const expectedEdge = left[offset + 2];
    const currentMean = right[offset];
    const currentRange = right[offset + 1];
    const currentEdge = right[offset + 2];

    const meanDifference = Math.abs(expectedMean - currentMean);
    const rangeDifference = Math.abs(expectedRange - currentRange);
    const edgeDifference = Math.abs(expectedEdge - currentEdge);
    totalMeanDifference += meanDifference;

    const expectedSmooth = expectedRange <= 42 && expectedEdge <= 16;
    const currentSmooth = currentRange <= 42 && currentEdge <= 16;
    const smoothToStructured = expectedSmooth &&
      (currentRange - expectedRange >= 30 ||
       currentEdge - expectedEdge >= 14);
    const structuredToSmooth = currentSmooth &&
      (expectedRange - currentRange >= 30 ||
       expectedEdge - currentEdge >= 14);
    const severe = meanDifference >= 24 ||
      smoothToStructured ||
      structuredToSmooth ||
      (rangeDifference >= 44 && edgeDifference >= 12);
    const isModerate = meanDifference >= 11 &&
      (rangeDifference >= 14 || edgeDifference >= 8);

    if (severe) severeCount += 1;
    if (isModerate) moderate.add(tile);

    const expectedRed = left[offset + 3];
    const expectedGreen = left[offset + 4];
    const expectedBlue = left[offset + 5];
    const currentRed = right[offset + 3];
    const currentGreen = right[offset + 4];
    const currentBlue = right[offset + 5];

    const expectedLuma =
      0.2126 * expectedRed +
      0.7152 * expectedGreen +
      0.0722 * expectedBlue;
    const currentLuma =
      0.2126 * currentRed +
      0.7152 * currentGreen +
      0.0722 * currentBlue;
    const lumaDifference = Math.abs(expectedLuma - currentLuma);
    totalLumaDifference += lumaDifference;
    maximumLumaDifference = Math.max(
      maximumLumaDifference,
      lumaDifference,
    );

    const expectedChroma =
      Math.max(expectedRed, expectedGreen, expectedBlue) -
      Math.min(expectedRed, expectedGreen, expectedBlue);
    const currentChroma =
      Math.max(currentRed, currentGreen, currentBlue) -
      Math.min(currentRed, currentGreen, currentBlue);
    totalChromaDifference += Math.abs(expectedChroma - currentChroma);

    totalRgbDifference +=
      Math.abs(expectedRed - currentRed) +
      Math.abs(expectedGreen - currentGreen) +
      Math.abs(expectedBlue - currentBlue);
  }

  const meanResidual = totalMeanDifference / tileCount;
  const meanLumaDifference = totalLumaDifference / tileCount;
  const meanChromaDifference = totalChromaDifference / tileCount;
  const meanRgbDifference = totalRgbDifference / (tileCount * 3);

  const tonalOrColourTamper =
    meanLumaDifference > REFERENCE_VISUAL_MAX_MEAN_LUMA_DIFFERENCE ||
    maximumLumaDifference >
      REFERENCE_VISUAL_MAX_SINGLE_TILE_LUMA_DIFFERENCE ||
    meanChromaDifference > REFERENCE_VISUAL_MAX_MEAN_CHROMA_DIFFERENCE ||
    meanRgbDifference > REFERENCE_VISUAL_MAX_MEAN_RGB_DIFFERENCE;

  if (meanResidual > 12 && !tonalOrColourTamper) {
    return { comparable: false, tampered: false };
  }

  let adjacent = false;
  for (const tile of moderate) {
    const x = tile % REFERENCE_VISUAL_GRID_COLUMNS;
    const y = Math.floor(tile / REFERENCE_VISUAL_GRID_COLUMNS);
    for (const other of moderate) {
      if (other === tile) continue;
      const ox = other % REFERENCE_VISUAL_GRID_COLUMNS;
      const oy = Math.floor(other / REFERENCE_VISUAL_GRID_COLUMNS);
      if (Math.abs(x - ox) <= 1 && Math.abs(y - oy) <= 1) {
        adjacent = true;
        break;
      }
    }
    if (adjacent) break;
  }

  return {
    comparable: true,
    tampered: severeCount > 0 || adjacent || tonalOrColourTamper,
  };
}

function compareReferenceVisualFingerprintsV3(expected, current) {
  if (!validReferenceVisualFingerprintV3(expected) ||
      !validReferenceVisualFingerprintV3(current) ||
      expected.mediaType !== current.mediaType) {
    return {
      verdict: 'inconclusive',
      alignedFrames: 0,
      modifiedFrames: 0,
      inconclusiveFrames: 0,
      expectedFrames: 0,
    };
  }

  const expectedFrames = expected.frames;
  const currentFrames = current.frames;
  if (expected.mediaType === 'photo') {
    const residual = compareReferenceVisualFrameV3(
      expectedFrames[0],
      currentFrames[0],
    );
    return {
      verdict: residual.tampered
        ? 'modified'
        : residual.comparable
          ? 'conforming'
          : 'inconclusive',
      alignedFrames: residual.comparable ? 1 : 0,
      modifiedFrames: residual.tampered ? 1 : 0,
      inconclusiveFrames: residual.comparable ? 0 : 1,
      expectedFrames: 1,
    };
  }

  const used = new Set();
  let aligned = 0;
  let modified = 0;
  let inconclusive = 0;

  for (let e = 0; e < expectedFrames.length; e += 1) {
    const center = expectedFrames.length <= 1 || currentFrames.length <= 1
      ? 0
      : Math.round(
          e * (currentFrames.length - 1) / (expectedFrames.length - 1),
        );
    const low = Math.max(0, center - 4);
    const high = Math.min(currentFrames.length - 1, center + 4);
    let bestIndex = -1;
    let bestDistance = 9999;

    for (let i = low; i <= high; i += 1) {
      if (used.has(i)) continue;
      const distance = referenceVisualHexDistanceV3(
        expectedFrames[e].globalHash,
        currentFrames[i].globalHash,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    if (bestIndex < 0 || bestDistance > 18) {
      inconclusive += 1;
      continue;
    }

    used.add(bestIndex);
    const residual = compareReferenceVisualFrameV3(
      expectedFrames[e],
      currentFrames[bestIndex],
    );
    if (!residual.comparable) {
      inconclusive += 1;
      continue;
    }
    aligned += 1;
    if (residual.tampered) modified += 1;
  }

  const minimumAligned = Math.max(2, Math.ceil(expectedFrames.length * 0.55));
  const verdict = modified > 0
    ? 'modified'
    : aligned >= minimumAligned &&
        inconclusive <= Math.ceil(expectedFrames.length * 0.35)
      ? 'conforming'
      : 'inconclusive';

  return {
    verdict,
    alignedFrames: aligned,
    modifiedFrames: modified,
    inconclusiveFrames: inconclusive,
    expectedFrames: expectedFrames.length,
  };
}

async function buildReferenceVisualFingerprintV3({
  ffmpegPath,
  filePath,
  mediaType,
  workDir,
}) {
  const rawPath = path.join(workDir, 'reference-visual-v3.raw');
  const filter = mediaType === 'video'
    ? 'fps=' + REFERENCE_VISUAL_VIDEO_FPS +
      ',scale=' + REFERENCE_VISUAL_WIDTH + ':' + REFERENCE_VISUAL_HEIGHT +
      ':force_original_aspect_ratio=decrease,pad=' +
      REFERENCE_VISUAL_WIDTH + ':' + REFERENCE_VISUAL_HEIGHT +
      ':(ow-iw)/2:(oh-ih)/2:color=black,format=rgb24'
    : 'scale=' + REFERENCE_VISUAL_WIDTH + ':' + REFERENCE_VISUAL_HEIGHT +
      ':force_original_aspect_ratio=decrease,pad=' +
      REFERENCE_VISUAL_WIDTH + ':' + REFERENCE_VISUAL_HEIGHT +
      ':(ow-iw)/2:(oh-ih)/2:color=black,format=rgb24';
  const args = [
    '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
    '-i', filePath,
    '-vf', filter,
    '-frames:v',
    String(
      mediaType === 'video'
        ? REFERENCE_VISUAL_MAX_VIDEO_FRAMES
        : 1,
    ),
    '-f', 'rawvideo',
    rawPath,
  ];
  try {
    await execFileAsync(ffmpegPath, args, {
      timeout: 180000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const raw = await fs.promises.readFile(rawPath);
    return referenceVisualFingerprintV3FromRaw(raw, mediaType);
  } finally {
    try { await fs.promises.rm(rawPath, { force: true }); } catch (_) {}
  }
}

function canonicalYoutubeReference(videoId) {
  if (!YOUTUBE_ID.test(videoId || '')) return null;
  return {
    platform: 'youtube',
    platformPostId: videoId,
    publicUrl: 'https://www.youtube.com/watch?v=' + videoId,
  };
}

function strictBoolean(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return null;
}

function certificateRsaPublicKey(certificate) {
  const publicKey = certificate?.publicKey;
  const modulus = String(publicKey?.modulus || '');
  const exponent = String(publicKey?.exponent || '');
  if (!modulus || !exponent) return null;
  try {
    const key = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: Buffer.from(modulus, 'base64').toString('base64url'),
        e: Buffer.from(exponent, 'base64').toString('base64url'),
      },
      format: 'jwk',
    });
    if (key.asymmetricKeyType !== 'rsa' ||
        key.asymmetricKeyDetails?.modulusLength < 2048) return null;
    return key;
  } catch (_) {
    return null;
  }
}

function sleepMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function configuredFfmpegPath() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    return require('ffmpeg-static');
  } catch (_) {
    return '/usr/bin/ffmpeg';
  }
}

function parsePinnedDerivationKeys() {
  const raw = String(process.env.SIGILLUM_DERIVATION_PUBLIC_KEYS_JSON || '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const result = {};
    for (const [keyId, pemValue] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) ||
          typeof pemValue !== 'string' || !pemValue) return null;
      const pem = pemValue.replace(/\\n/g, '\n');
      const key = crypto.createPublicKey(pem);
      if (key.asymmetricKeyType !== 'rsa' ||
          key.asymmetricKeyDetails?.modulusLength < 2048) return null;
      result[keyId] = pem;
    }
    return Object.keys(result).length ? result : null;
  } catch (_) {
    return null;
  }
}

function verifyDerivationManifest({
  manifest,
  certificateRaw,
  trustedKeys,
  verifyCertificateRaw,
}) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !trustedKeys || manifest.schema !== DERIVATION_SCHEMA ||
        !HCV_ID.test(manifest.hcvId)) return false;

    const { signature, ...statement } = manifest;
    if (Object.keys(statement).length !== 8 ||
        typeof signature !== 'string' || !signature) return false;

    const certificate = verifyCertificateRaw(certificateRaw, manifest.hcvId);
    const contentHash = String(certificate?.content?.hash || '').toLowerCase();
    const contentType = String(certificate?.content?.type || '');
    const expectedOperation = contentType === 'video'
      ? DERIVATION_OPERATION
      : contentType === 'photo'
        ? PHOTO_DERIVATION_OPERATION
        : null;
    if (!expectedOperation ||
        !SHA256.test(contentHash) ||
        statement.parent?.kind !== 'original' ||
        statement.parent?.sha256 !== contentHash ||
        statement.parent?.signedCertificateDigest !== hashString(certificateRaw) ||
        statement.output?.mediaType !== 'video' ||
        (statement.output?.referenceVisualFingerprint != null &&
          !validReferenceVisualFingerprintV3(
            statement.output.referenceVisualFingerprint,
          )) ||
        !Number.isSafeInteger(statement.output?.byteLength) ||
        statement.output.byteLength <= 0 ||
        !SHA256.test(statement.output?.sha256 || '') ||
        statement.output.sha256 === contentHash ||
        statement.transform?.operation !== expectedOperation ||
        statement.transform?.editorialImpact !== 'non_editorial' ||
        statement.transform?.policyVersion !== 'SIGILLUM_NON_EDITORIAL_V1' ||
        statement.issuer?.signatureAlgorithm !== DERIVATION_SIGNATURE_ALGORITHM ||
        !/^[A-Za-z0-9._-]{3,80}$/.test(statement.issuer?.keyId || '') ||
        !/^[0-9a-f-]{36}$/i.test(statement.nonce || '') ||
        !Number.isFinite(Date.parse(statement.createdAt))) {
      return false;
    }

    const pem = trustedKeys[statement.issuer.keyId];
    if (!pem) return false;
    const publicKey = crypto.createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== 'rsa' ||
        publicKey.asymmetricKeyDetails?.modulusLength < 2048) return false;

    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(JSON.stringify(statement), 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch (_) {
    return false;
  }
}

function verifySubtitleDerivationManifest({
  manifest,
  certificateRaw,
  trustedKeys,
  verifyCertificateRaw,
}) {
  try {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
        !trustedKeys ||
        manifest.schema !== SUBTITLE_DERIVATION_SCHEMA ||
        !HCV_ID.test(manifest.hcvId)) {
      return false;
    }

    const { signature, ...statement } = manifest;
    if (Object.keys(statement).length !== 9 ||
        typeof signature !== 'string' ||
        !signature) {
      return false;
    }

    const certificate = verifyCertificateRaw(certificateRaw, manifest.hcvId);
    const contentHash = String(certificate?.content?.hash || '').toLowerCase();
    const contentType = String(certificate?.content?.type || '');
    if (contentType !== 'video' ||
        !SHA256.test(contentHash) ||
        statement.parent?.kind !== 'original' ||
        statement.parent?.sha256 !== contentHash ||
        statement.parent?.signedCertificateDigest !== hashString(certificateRaw) ||
        statement.source?.kind !== 'captioned_video' ||
        !SHA256.test(statement.source?.sha256 || '') ||
        !SHA256.test(statement.source?.subtitleSha256 || '') ||
        statement.output?.mediaType !== 'video' ||
        !Number.isSafeInteger(statement.output?.byteLength) ||
        statement.output.byteLength <= 0 ||
        !SHA256.test(statement.output?.sha256 || '') ||
        !validReferenceVisualFingerprintV3(
          statement.output?.referenceVisualFingerprint,
        ) ||
        statement.transform?.operation !== SUBTITLE_DERIVATION_OPERATION ||
        statement.transform?.editorialImpact !== 'caption_overlay' ||
        statement.transform?.policyVersion !== SUBTITLE_DERIVATION_SCHEMA ||
        statement.issuer?.signatureAlgorithm !== DERIVATION_SIGNATURE_ALGORITHM ||
        !/^[A-Za-z0-9._-]{3,80}$/.test(statement.issuer?.keyId || '') ||
        !/^[0-9a-f-]{36}$/i.test(statement.nonce || '') ||
        !Number.isFinite(Date.parse(statement.createdAt))) {
      return false;
    }

    const pem = trustedKeys[statement.issuer.keyId];
    if (!pem) return false;
    const publicKey = crypto.createPublicKey(pem);
    if (publicKey.asymmetricKeyType !== 'rsa' ||
        publicKey.asymmetricKeyDetails?.modulusLength < 2048) {
      return false;
    }

    return crypto.verify(
      'RSA-SHA256',
      Buffer.from(JSON.stringify(statement), 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    );
  } catch (_) {
    return false;
  }
}

function createVerifiedOriginalsProduction({
  pool,
  authenticate,
  accountEnvelope,
  requireCreatorAccess,
  verifyCertificateRaw,
  provenanceEnvelopeFromRow,
  sendJson,
  sendHtml,
  publicError,
  readJson,
  securityEvent,
  fetchImpl = global.fetch,
  sleep = sleepMs,
  ffmpegPath = configuredFfmpegPath(),
  primaryReferenceProviderOverride = null,
} = {}) {
  for (const [name, value] of Object.entries({
    pool,
    authenticate,
    accountEnvelope,
    requireCreatorAccess,
    verifyCertificateRaw,
    provenanceEnvelopeFromRow,
    sendJson,
    sendHtml,
    publicError,
    readJson,
  })) {
    if (!value) throw new Error('VERIFIED_ORIGINALS_DEPENDENCY_MISSING_' + name);
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('VERIFIED_ORIGINALS_FETCH_UNAVAILABLE');
  }

  const fail = (code, status = 400, message) => {
    throw publicError(code, status, message);
  };

  const primaryReferenceProviderName =
    primaryReferenceProviderOverride?.name ||
    selectPrimaryReferenceProvider(process.env);
  let r2ReferenceProvider = null;
  if (primaryReferenceProviderName === 'r2') {
    r2ReferenceProvider =
      primaryReferenceProviderOverride ||
      createR2ReferenceProvider({ env: process.env });
  }

  function requireR2ReferenceProvider() {
    if (primaryReferenceProviderName !== 'r2') {
      fail('PRIMARY_REFERENCE_PROVIDER_NOT_R2', 500);
    }
    if (!r2ReferenceProvider) {
      r2ReferenceProvider = createR2ReferenceProvider({ env: process.env });
    }
    return r2ReferenceProvider;
  }

  let takedownTimer = null;
  let youtubeAccessTokenCache = '';
  let youtubeAccessTokenExpiresAt = 0;
  let youtubeChannelVerifiedId = '';
  let youtubeChannelVerifiedUntil = 0;
  const youtubeReferenceStatusCache = new Map();

  function verifyHcvpackBindingSignature(req, original, hcvId, hcvpackSha256) {
    if (String(req.headers['x-sigillum-hcvpack-binding-version'] || '') !== '1') {
      return false;
    }
    const signature = String(req.headers['x-sigillum-hcvpack-signature'] || '');
    if (!signature) return false;
    const publicKey = certificateRsaPublicKey(original.certificate);
    if (!publicKey) return false;
    const statement =
      'SIGILLUM_HCVPACK_BINDING_V1|' + hcvId + '|' +
      original.contentHash + '|' + hcvpackSha256;
    try {
      return crypto.verify(
        'RSA-SHA256',
        Buffer.from(statement, 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch (_) {
      return false;
    }
  }

  function verifySubtitleDerivationBindingSignature(
    req,
    original,
    hcvId,
    captionedSha256,
    subtitleSha256,
    hcvpackSha256,
  ) {
    if (String(req.headers['x-sigillum-subtitle-binding-version'] || '') !== '1') {
      return false;
    }
    const signature = String(
      req.headers['x-sigillum-subtitle-derivation-signature'] || '',
    );
    if (!signature ||
        !SHA256.test(captionedSha256) ||
        !SHA256.test(subtitleSha256) ||
        !SHA256.test(hcvpackSha256)) {
      return false;
    }
    const publicKey = certificateRsaPublicKey(original.certificate);
    if (!publicKey) return false;
    const statement = [
      'SIGILLUM_SUBTITLE_DERIVATION_BINDING_V1',
      hcvId,
      original.contentHash,
      captionedSha256,
      subtitleSha256,
      hcvpackSha256,
    ].join('|');
    try {
      return crypto.verify(
        'RSA-SHA256',
        Buffer.from(statement, 'utf8'),
        publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch (_) {
      return false;
    }
  }

  function youtubeServiceConfigured() {
    return Boolean(
      process.env.YOUTUBE_CLIENT_ID &&
      process.env.YOUTUBE_CLIENT_SECRET &&
      process.env.YOUTUBE_REFRESH_TOKEN &&
      YOUTUBE_CHANNEL_ID.test(String(process.env.YOUTUBE_CHANNEL_ID || '')),
    );
  }

  async function initSchema() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verified_originals_consents (
        record_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        creator_id TEXT NOT NULL,
        session_device_fingerprint TEXT NOT NULL,
        consent_version TEXT NOT NULL,
        publication_consent BOOLEAN NOT NULL,
        monetization_consent BOOLEAN NOT NULL,
        rights_confirmed BOOLEAN NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('ACTIVE','WITHDRAWN')),
        consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        withdrawn_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS verified_originals_consents_hcv_idx
        ON verified_originals_consents(hcv_id, consented_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS verified_originals_one_active_consent_idx
        ON verified_originals_consents(hcv_id)
        WHERE state='ACTIVE';

      CREATE TABLE IF NOT EXISTS trusted_derivations (
        output_sha256 TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        manifest_raw TEXT NOT NULL,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS trusted_derivations_hcv_idx
        ON trusted_derivations(hcv_id, registered_at DESC);

      CREATE TABLE IF NOT EXISTS verified_originals_platform_receipts (
        receipt_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_post_id TEXT NOT NULL,
        uploaded_sha256 TEXT NOT NULL,
        upload_session_hash TEXT NOT NULL,
        processing_status TEXT NOT NULL,
        visibility TEXT NOT NULL,
        publisher_subject_hash TEXT NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(platform, platform_post_id)
      );

      CREATE TABLE IF NOT EXISTS verified_originals_publications (
        publication_id TEXT PRIMARY KEY,
        hcv_id TEXT NOT NULL REFERENCES certificates(hcv_id) ON DELETE CASCADE,
        platform TEXT NOT NULL,
        platform_post_id TEXT NOT NULL,
        public_url TEXT NOT NULL,
        reference_sha256 TEXT NOT NULL,
        original_content_sha256 TEXT NOT NULL,
        derived_from TEXT NOT NULL,
        derivation_type TEXT NOT NULL,
        derivation_manifest_sha256 TEXT NOT NULL,
        platform_receipt_id TEXT NOT NULL REFERENCES verified_originals_platform_receipts(receipt_id),
        created_at TIMESTAMPTZ NOT NULL,
        publication_status TEXT NOT NULL CHECK(publication_status IN ('PUBLISHED','REVOKED','UNAVAILABLE')),
        consent_record_id TEXT NOT NULL REFERENCES verified_originals_consents(record_id),
        consent_version TEXT NOT NULL,
        monetization_consent BOOLEAN NOT NULL,
        published_by TEXT NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at TIMESTAMPTZ,
        unavailable_at TIMESTAMPTZ,
        audit_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE(platform, platform_post_id)
      );
      ALTER TABLE verified_originals_publications
        ADD COLUMN IF NOT EXISTS hcvpack_sha256 TEXT NOT NULL DEFAULT '';
      ALTER TABLE verified_originals_publications
        ADD COLUMN IF NOT EXISTS reference_role TEXT NOT NULL DEFAULT 'ORIGINAL_REFERENCE';
      ALTER TABLE verified_originals_publications
        ADD COLUMN IF NOT EXISTS source_derivation_sha256 TEXT NOT NULL DEFAULT '';
      ALTER TABLE verified_originals_publications
        ADD COLUMN IF NOT EXISTS subtitle_sha256 TEXT NOT NULL DEFAULT '';
      CREATE INDEX IF NOT EXISTS verified_originals_publications_hcv_idx
        ON verified_originals_publications(hcv_id, published_at DESC);

      CREATE TABLE IF NOT EXISTS verified_originals_audit (
        id BIGSERIAL PRIMARY KEY,
        hcv_id TEXT NOT NULL,
        publication_id TEXT,
        event_type TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        actor_subject_hash TEXT NOT NULL,
        metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS verified_originals_audit_hcv_idx
        ON verified_originals_audit(hcv_id, id DESC);
    `);
    await initPrimaryReferenceLifecycleSchema(pool);
    await initPrimaryReferenceReadAuthSchema(pool);
    startTakedownWorker();
  }

  async function certificateRow(hcvId) {
    if (!HCV_ID.test(hcvId || '')) return null;
    return (await pool.query(`
      SELECT
        hcv_id,account_id,created_at,certificate_raw,certificate_sha256,
        account_subject_hash,device_key_fingerprint,creator_id,binding_version,
        content_sha256,identity_verified,registry_attested_at,provenance_version,
        registry_attestation_sha256
      FROM certificates
      WHERE hcv_id=$1
    `, [hcvId])).rows[0] || null;
  }

  function cameraCaptureBinding(certificate, row, hcvId) {
    const content = certificate?.content;
    const claims = certificate?.claims;
    const binding = claims?.provenance;
    const event = binding?.event;
    const metadata = event?.metadata;
    const contentType = String(content?.type || '');
    const contentHash = String(content?.hash || '').toLowerCase();
    const contentSize = Number(content?.size);
    const sessionId = String(certificate?.sessionId || '');

    const valid =
      (contentType === 'video' || contentType === 'photo') &&
      claims?.captureSource === 'HCV_CAMERA' &&
      claims?.liveCapture === true &&
      binding?.type === CAPTURE_PROVENANCE_TYPE &&
      binding?.version === 1 &&
      binding?.status === 'VERIFIED' &&
      binding?.hcvId === hcvId &&
      binding?.inputHash === contentHash &&
      binding?.deviceFingerprint === String(row?.device_key_fingerprint || '').toLowerCase() &&
      binding?.sessionId === sessionId &&
      binding?.pipelineVersion === CAPTURE_PROVENANCE_PIPELINE &&
      binding?.eventHash === event?.eventHash &&
      event?.type === 'SIGILLUM_PROVENANCE_EVENT' &&
      event?.version === 1 &&
      event?.sequence === 0 &&
      event?.eventType === 'CAPTURE_FINALIZED' &&
      event?.inputHash === contentHash &&
      event?.deviceFingerprint === String(row?.device_key_fingerprint || '').toLowerCase() &&
      event?.sessionId === sessionId &&
      event?.pipelineVersion === CAPTURE_PROVENANCE_PIPELINE &&
      event?.parentEvent === 'GENESIS' &&
      metadata?.hcvId === hcvId &&
      metadata?.captureSource === 'HCV_CAMERA' &&
      metadata?.mediaType === contentType &&
      Number(metadata?.contentSize) === contentSize;

    return {
      valid,
      contentType,
      contentHash,
      contentSize,
    };
  }

  async function verifiedOriginal(hcvId) {
    const row = await certificateRow(hcvId);
    if (!row) return null;
    let certificate;
    try {
      certificate = verifyCertificateRaw(row.certificate_raw, hcvId);
    } catch (_) {
      return null;
    }
    const provenance = provenanceEnvelopeFromRow(row);
    const capture = cameraCaptureBinding(certificate, row, hcvId);
    const contentHash = capture.contentHash;
    const contentSize = capture.contentSize;
    if (!capture.valid ||
        provenance?.status !== 'SIGILLUM_REGISTRY_VERIFIED' ||
        provenance.integrityValid !== true ||
        provenance.identityVerified !== true ||
        provenance.contentSha256 !== contentHash ||
        row.content_sha256 !== contentHash ||
        !SHA256.test(contentHash) ||
        !Number.isSafeInteger(contentSize) ||
        contentSize <= 0) {
      return null;
    }
    return { row, certificate, provenance, contentHash, contentSize, contentType: capture.contentType };
  }

  async function ownedOriginal(hcvId, session) {
    const original = await verifiedOriginal(hcvId);
    if (!original) fail('CERTIFICATE_NOT_ACTIVE_VERIFIED', 403);
    if (!session?.account_id || original.row.account_id !== session.account_id) {
      fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
    }
    const creatorId = String(session.creator_id || '');
    if (!creatorId || creatorId !== String(original.row.creator_id || '')) {
      fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
    }
    return original;
  }

  async function creatorAccess(req) {
    const access = await requireCreatorAccess(req);
    if (access?.account?.subscriptionStatus !== 'active') {
      fail('SUBSCRIPTION_REQUIRED', 402);
    }
    return access;
  }

  async function audit({
    hcvId,
    publicationId = null,
    eventType,
    actorType,
    actorSubjectHash,
    metadata = {},
    client = pool,
  }) {
    await client.query(`
      INSERT INTO verified_originals_audit(
        hcv_id,publication_id,event_type,actor_type,actor_subject_hash,metadata_json
      ) VALUES($1,$2,$3,$4,$5,$6)
    `, [
      hcvId,
      publicationId,
      eventType,
      actorType,
      actorSubjectHash,
      metadata && typeof metadata === 'object' ? metadata : {},
    ]);
  }

  async function activeConsent(hcvId) {
    return (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE hcv_id=$1 AND state='ACTIVE'
      ORDER BY consented_at DESC
      LIMIT 1
    `, [hcvId])).rows[0] || null;
  }

  async function activeYoutubeReference(hcvId) {
    const original = await verifiedOriginal(hcvId);
    if (!original) return null;
    const row = (await pool.query(`
      SELECT
        p.*,
        c.state AS consent_state,
        r.hcv_id AS receipt_hcv_id,
        r.platform AS receipt_platform,
        r.platform_post_id AS receipt_platform_post_id,
        r.uploaded_sha256 AS receipt_uploaded_sha256,
        r.processing_status AS receipt_processing_status,
        r.visibility AS receipt_visibility
      FROM verified_originals_publications p
      JOIN verified_originals_consents c ON c.record_id=p.consent_record_id
      JOIN verified_originals_platform_receipts r ON r.receipt_id=p.platform_receipt_id
      WHERE p.hcv_id=$1
        AND p.publication_status='PUBLISHED'
        AND p.reference_role=$2
      ORDER BY p.published_at DESC
      LIMIT 1
    `, [hcvId, ORIGINAL_REFERENCE_ROLE])).rows[0];
    if (!row ||
        row.consent_state !== 'ACTIVE' ||
        row.original_content_sha256 !== original.contentHash ||
        row.derived_from !== original.contentHash ||
        row.receipt_hcv_id !== hcvId ||
        row.receipt_platform !== row.platform ||
        row.receipt_platform_post_id !== row.platform_post_id ||
        row.receipt_uploaded_sha256 !== row.reference_sha256 ||
        row.receipt_processing_status !== 'succeeded' ||
        row.receipt_visibility !== 'unlisted' ||
        !SHA256.test(row.reference_sha256 || '')) {
      return null;
    }
    const reference = canonicalYoutubeReference(row.platform_post_id);
    if (!reference || row.platform !== 'youtube' || reference.publicUrl !== row.public_url) {
      return null;
    }
    return {
      publicationId: row.publication_id,
      hcvId,
      platform: 'youtube',
      platformPostId: row.platform_post_id,
      publicUrl: row.public_url,
      referenceSha256: row.reference_sha256,
      originalContentSha256: row.original_content_sha256,
      hcvpackSha256: row.hcvpack_sha256,
      derivedFrom: row.derived_from,
      derivationType: row.derivation_type,
      publicationStatus: row.publication_status,
      certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
      socialFileVerdict: 'NOT_VERIFIED',
      referenceVisualFingerprint: await (async () => {
        try {
          const derivationRow = (await pool.query(
            'SELECT manifest_raw FROM trusted_derivations WHERE output_sha256=$1 AND hcv_id=$2',
            [row.reference_sha256, hcvId],
          )).rows[0];
          if (!derivationRow) return null;
          const manifest = JSON.parse(derivationRow.manifest_raw);
          const trustedKeys = parsePinnedDerivationKeys();
          if (!verifyDerivationManifest({
            manifest,
            certificateRaw: original.row.certificate_raw,
            trustedKeys,
            verifyCertificateRaw,
          })) return null;
          const fingerprint = manifest.output?.referenceVisualFingerprint;
          return validReferenceVisualFingerprintV3(fingerprint)
            ? fingerprint
            : null;
        } catch (_) {
          return null;
        }
      })(),
      publishedAt: row.published_at,
    };
  }

  async function activeR2Reference(hcvId) {
    const original = await verifiedOriginal(hcvId);
    if (!original) return null;
    const job = await availablePrimaryReference(
      pool,
      hcvId,
      ORIGINAL_REFERENCE_ROLE,
    );
    if (!job || job.provider !== 'r2' || !job.receipt) return null;

    const row = (await pool.query(`
      SELECT
        p.*,
        c.state AS consent_state,
        r.hcv_id AS receipt_hcv_id,
        r.platform AS receipt_platform,
        r.platform_post_id AS receipt_platform_post_id,
        r.uploaded_sha256 AS receipt_uploaded_sha256,
        r.processing_status AS receipt_processing_status,
        r.visibility AS receipt_visibility
      FROM verified_originals_publications p
      JOIN verified_originals_consents c ON c.record_id=p.consent_record_id
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      WHERE p.hcv_id=$1
        AND p.platform='r2'
        AND p.platform_post_id=$2
        AND p.publication_status='PUBLISHED'
        AND p.reference_role=$3
      ORDER BY p.published_at DESC
      LIMIT 1
    `, [
      hcvId,
      job.objectId,
      ORIGINAL_REFERENCE_ROLE,
    ])).rows[0];

    if (!row ||
        row.consent_state !== 'ACTIVE' ||
        row.original_content_sha256 !== original.contentHash ||
        row.derived_from !== original.contentHash ||
        row.reference_sha256 !== job.referenceSha256 ||
        row.hcvpack_sha256 !== job.hcvpackSha256 ||
        row.receipt_hcv_id !== hcvId ||
        row.receipt_platform !== 'r2' ||
        row.receipt_platform_post_id !== job.objectId ||
        row.receipt_uploaded_sha256 !== job.receipt.ciphertextSha256 ||
        row.receipt_processing_status !== 'succeeded' ||
        row.receipt_visibility !== 'private' ||
        !SHA256.test(row.reference_sha256 || '')) {
      return null;
    }

    let manifest;
    try {
      const derivationRow = (await pool.query(
        'SELECT manifest_raw FROM trusted_derivations WHERE output_sha256=$1 AND hcv_id=$2',
        [row.reference_sha256, hcvId],
      )).rows[0];
      if (!derivationRow) return null;
      manifest = JSON.parse(derivationRow.manifest_raw);
      const trustedKeys = parsePinnedDerivationKeys();
      if (!verifyPrimaryReferenceManifest({
        manifest,
        certificateRaw: original.row.certificate_raw,
        trustedKeys,
      })) {
        return null;
      }
    } catch (_) {
      return null;
    }

    const fingerprint = manifest.output?.referenceVisualFingerprint;
    if (!validReferenceVisualFingerprintV3(fingerprint)) return null;

    return {
      publicationId: row.publication_id,
      hcvId,
      platform: 'r2',
      referenceSha256: row.reference_sha256,
      originalContentSha256: row.original_content_sha256,
      hcvpackSha256: row.hcvpack_sha256,
      derivedFrom: row.derived_from,
      derivationType: row.derivation_type,
      publicationStatus: row.publication_status,
      certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
      socialFileVerdict: 'NOT_VERIFIED',
      referenceVisualFingerprint: fingerprint,
      referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
      referenceRole: row.reference_role,
      publishedAt: row.published_at,
      lifecycleJobId: job.jobId,
      providerReceipt: job.receipt,
    };
  }

  async function activeReference(hcvId) {
    if (primaryReferenceProviderName === 'r2') {
      return activeR2Reference(hcvId);
    }
    return activeYoutubeReference(hcvId);
  }

  function referenceViewEnvelope(reference) {
    if (!reference || typeof reference !== 'object') return null;
    const common = {
      publicationId: reference.publicationId,
      hcvId: reference.hcvId,
      platform: reference.platform,
      referenceSha256: reference.referenceSha256,
      originalContentSha256: reference.originalContentSha256,
      hcvpackSha256: reference.hcvpackSha256,
      derivedFrom: reference.derivedFrom,
      derivationType: reference.derivationType,
      publicationStatus: reference.publicationStatus,
      certificateVerdict: reference.certificateVerdict,
      socialFileVerdict: reference.socialFileVerdict,
      referenceVisualFingerprint: reference.referenceVisualFingerprint,
      publishedAt: reference.publishedAt,
    };
    if (reference.platform === 'youtube') {
      return {
        ...common,
        platformPostId: reference.platformPostId,
        publicUrl: reference.publicUrl,
      };
    }
    if (reference.platform === 'r2') {
      return {
        ...common,
        referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
        readAuthorizationPath:
          '/api/verified-originals/' +
          encodeURIComponent(reference.hcvId) +
          '/read-authorization',
      };
    }
    return common;
  }

  async function activeYoutubeSubtitleReference(
    hcvId,
    captionedSha256,
    subtitleSha256,
  ) {
    if (!SHA256.test(captionedSha256) || !SHA256.test(subtitleSha256)) {
      return null;
    }
    const original = await verifiedOriginal(hcvId);
    if (!original || original.contentType !== 'video') return null;

    const row = (await pool.query(`
      SELECT
        p.*,
        c.state AS consent_state,
        r.hcv_id AS receipt_hcv_id,
        r.platform AS receipt_platform,
        r.platform_post_id AS receipt_platform_post_id,
        r.uploaded_sha256 AS receipt_uploaded_sha256,
        r.processing_status AS receipt_processing_status,
        r.visibility AS receipt_visibility
      FROM verified_originals_publications p
      JOIN verified_originals_consents c ON c.record_id=p.consent_record_id
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      WHERE p.hcv_id=$1
        AND p.publication_status='PUBLISHED'
        AND p.reference_role=$2
        AND p.source_derivation_sha256=$3
        AND p.subtitle_sha256=$4
      ORDER BY p.published_at DESC
      LIMIT 1
    `, [
      hcvId,
      DERIVED_REFERENCE_ROLE,
      captionedSha256,
      subtitleSha256,
    ])).rows[0];

    if (!row ||
        row.consent_state !== 'ACTIVE' ||
        row.original_content_sha256 !== original.contentHash ||
        row.derived_from !== original.contentHash ||
        row.derivation_type !== SUBTITLE_DERIVATION_OPERATION ||
        row.receipt_hcv_id !== hcvId ||
        row.receipt_platform !== 'youtube' ||
        row.receipt_platform_post_id !== row.platform_post_id ||
        row.receipt_uploaded_sha256 !== row.reference_sha256 ||
        row.receipt_processing_status !== 'succeeded' ||
        row.receipt_visibility !== 'unlisted' ||
        !SHA256.test(row.reference_sha256 || '')) {
      return null;
    }

    const derivationRow = (await pool.query(
      'SELECT manifest_raw FROM trusted_derivations WHERE output_sha256=$1 AND hcv_id=$2',
      [row.reference_sha256, hcvId],
    )).rows[0];
    if (!derivationRow) return null;

    let manifest;
    try {
      manifest = JSON.parse(derivationRow.manifest_raw);
    } catch (_) {
      return null;
    }
    const trustedKeys = parsePinnedDerivationKeys();
    if (!verifySubtitleDerivationManifest({
      manifest,
      certificateRaw: original.row.certificate_raw,
      trustedKeys,
      verifyCertificateRaw,
    })) {
      return null;
    }
    if (manifest.source?.sha256 !== captionedSha256 ||
        manifest.source?.subtitleSha256 !== subtitleSha256) {
      return null;
    }
    const referenceVisualFingerprint =
      manifest.output?.referenceVisualFingerprint;
    if (!validReferenceVisualFingerprintV3(referenceVisualFingerprint)) {
      return null;
    }

    const reference = canonicalYoutubeReference(row.platform_post_id);
    if (!reference || reference.publicUrl !== row.public_url) return null;

    return {
      publicationId: row.publication_id,
      hcvId,
      platform: 'youtube',
      platformPostId: row.platform_post_id,
      publicUrl: row.public_url,
      referenceSha256: row.reference_sha256,
      originalContentSha256: row.original_content_sha256,
      sourceDerivationSha256: row.source_derivation_sha256,
      subtitleSha256: row.subtitle_sha256,
      derivationType: row.derivation_type,
      referenceRole: row.reference_role,
      publicationStatus: row.publication_status,
      referenceVisualFingerprint,
      publishedAt: row.published_at,
    };
  }

  async function activeR2SubtitleReference(
    hcvId,
    captionedSha256,
    subtitleSha256,
  ) {
    if (!SHA256.test(captionedSha256) ||
        !SHA256.test(subtitleSha256)) {
      return null;
    }
    const original = await verifiedOriginal(hcvId);
    if (!original || original.contentType !== 'video') return null;

    const job = await availablePrimaryReference(
      pool,
      hcvId,
      DERIVED_REFERENCE_ROLE,
    );
    if (!job || job.provider !== 'r2' || !job.receipt) return null;

    const row = (await pool.query(`
      SELECT
        p.*,
        c.state AS consent_state,
        r.hcv_id AS receipt_hcv_id,
        r.platform AS receipt_platform,
        r.platform_post_id AS receipt_platform_post_id,
        r.uploaded_sha256 AS receipt_uploaded_sha256,
        r.processing_status AS receipt_processing_status,
        r.visibility AS receipt_visibility
      FROM verified_originals_publications p
      JOIN verified_originals_consents c ON c.record_id=p.consent_record_id
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      WHERE p.hcv_id=$1
        AND p.platform='r2'
        AND p.platform_post_id=$2
        AND p.publication_status='PUBLISHED'
        AND p.reference_role=$3
        AND p.source_derivation_sha256=$4
        AND p.subtitle_sha256=$5
      ORDER BY p.published_at DESC
      LIMIT 1
    `, [
      hcvId,
      job.objectId,
      DERIVED_REFERENCE_ROLE,
      captionedSha256,
      subtitleSha256,
    ])).rows[0];

    if (!row ||
        row.consent_state !== 'ACTIVE' ||
        row.original_content_sha256 !== original.contentHash ||
        row.derived_from !== original.contentHash ||
        row.derivation_type !== SUBTITLE_DERIVATION_OPERATION ||
        row.receipt_hcv_id !== hcvId ||
        row.receipt_platform !== 'r2' ||
        row.receipt_platform_post_id !== job.objectId ||
        row.receipt_uploaded_sha256 !== job.receipt.ciphertextSha256 ||
        row.receipt_processing_status !== 'succeeded' ||
        row.receipt_visibility !== 'private' ||
        row.reference_sha256 !== job.referenceSha256 ||
        !SHA256.test(row.reference_sha256 || '')) {
      return null;
    }

    const derivationRow = (await pool.query(
      'SELECT manifest_raw FROM trusted_derivations WHERE output_sha256=$1 AND hcv_id=$2',
      [row.reference_sha256, hcvId],
    )).rows[0];
    if (!derivationRow) return null;

    let manifest;
    try {
      manifest = JSON.parse(derivationRow.manifest_raw);
    } catch (_) {
      return null;
    }
    const trustedKeys = parsePinnedDerivationKeys();
    if (!verifySubtitleDerivationManifest({
      manifest,
      certificateRaw: original.row.certificate_raw,
      trustedKeys,
      verifyCertificateRaw,
    })) {
      return null;
    }
    if (manifest.source?.sha256 !== captionedSha256 ||
        manifest.source?.subtitleSha256 !== subtitleSha256) {
      return null;
    }
    const referenceVisualFingerprint =
      manifest.output?.referenceVisualFingerprint;
    if (!validReferenceVisualFingerprintV3(referenceVisualFingerprint)) {
      return null;
    }

    return {
      publicationId: row.publication_id,
      hcvId,
      platform: 'r2',
      referenceSha256: row.reference_sha256,
      originalContentSha256: row.original_content_sha256,
      hcvpackSha256: row.hcvpack_sha256,
      sourceDerivationSha256: row.source_derivation_sha256,
      subtitleSha256: row.subtitle_sha256,
      derivationType: row.derivation_type,
      referenceRole: row.reference_role,
      publicationStatus: row.publication_status,
      referenceVisualFingerprint,
      referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
      publishedAt: row.published_at,
      lifecycleJobId: job.jobId,
      providerReceipt: job.receipt,
    };
  }

  async function activeSubtitleReference(
    hcvId,
    captionedSha256,
    subtitleSha256,
  ) {
    if (primaryReferenceProviderName === 'r2') {
      return activeR2SubtitleReference(
        hcvId,
        captionedSha256,
        subtitleSha256,
      );
    }
    return activeYoutubeSubtitleReference(
      hcvId,
      captionedSha256,
      subtitleSha256,
    );
  }

  async function latestActiveSubtitleReference(hcvId) {
    const row = (await pool.query(`
      SELECT source_derivation_sha256,subtitle_sha256
      FROM verified_originals_publications
      WHERE hcv_id=$1
        AND publication_status='PUBLISHED'
        AND reference_role=$2
        AND derivation_type=$3
      ORDER BY published_at DESC
      LIMIT 1
    `, [
      hcvId,
      DERIVED_REFERENCE_ROLE,
      SUBTITLE_DERIVATION_OPERATION,
    ])).rows[0];
    if (!row ||
        !SHA256.test(row.source_derivation_sha256 || '') ||
        !SHA256.test(row.subtitle_sha256 || '')) {
      return null;
    }
    return activeSubtitleReference(
      hcvId,
      row.source_derivation_sha256,
      row.subtitle_sha256,
    );
  }

  async function authorizedVerificationDerivations(hcvId) {
    const reference = await latestActiveSubtitleReference(hcvId);
    if (!reference ||
        !validReferenceVisualFingerprintV3(
          reference.referenceVisualFingerprint,
        )) {
      return [];
    }

    if (reference.platform === 'r2') {
      try {
        const exists = await requireR2ReferenceProvider()
          .referenceExists(reference.providerReceipt);
        if (!exists) return [];
      } catch (_) {
        return [];
      }
    } else if (reference.platform === 'youtube') {
      const live = await liveYoutubeReferenceStatus(reference);
      if (live.availability !== 'REFERENCE_AVAILABLE') return [];
    } else {
      return [];
    }

    return [{
      referenceRole: reference.referenceRole,
      derivationType: reference.derivationType,
      editorialImpact: 'caption_overlay',
      referenceVisualFingerprint: reference.referenceVisualFingerprint,
    }];
  }

  async function publicAvailability(hcvId) {
    const reference = await activeReference(hcvId);
    if (!reference) {
      return { hcvId, availability: 'REFERENCE_NOT_AVAILABLE', socialFileVerdict: 'NOT_VERIFIED' };
    }
    return {
      hcvId,
      availability: 'REFERENCE_AVAILABLE',
      publicationStatus: 'PUBLISHED',
      platform: reference.platform,
      hcvpackSha256: reference.hcvpackSha256,
      certificateVerdict: 'CERTIFICATE_RECORD_VERIFIED',
      socialFileVerdict: 'NOT_VERIFIED',
      referenceVisualFingerprint: reference.referenceVisualFingerprint,
      viewAccess: 'SUBSCRIPTION_REQUIRED',
    };
  }

  async function verificationReference(hcvId) {
    const startedAt = Date.now();
    const reference = await activeReference(hcvId);
    if (!reference) {
      return {
        hcvId,
        availability: 'REFERENCE_NOT_AVAILABLE',
        youtubeLive: false,
        r2Live: false,
        referenceLive: false,
        comparisonMode:
          primaryReferenceProviderName === 'r2'
            ? 'R2_PRIVATE_EXACT_REFERENCE_SIGNED_V1'
            : 'YOUTUBE_LIVE_ATTESTED_SIGNED_V3',
        authorizedDerivations: [],
        totalMs: Date.now() - startedAt,
      };
    }

    if (reference.platform === 'r2') {
      const providerStartedAt = Date.now();
      try {
        const exists = await requireR2ReferenceProvider()
          .referenceExists(reference.providerReceipt);
        return {
          hcvId,
          availability: exists
            ? 'REFERENCE_AVAILABLE'
            : 'REFERENCE_NOT_AVAILABLE',
          platform: 'r2',
          youtubeLive: false,
          r2Live: exists,
          referenceLive: exists,
          comparisonMode: 'R2_PRIVATE_EXACT_REFERENCE_SIGNED_V1',
          referenceVisualFingerprint:
            exists ? reference.referenceVisualFingerprint : null,
          authorizedDerivations:
            exists ? await authorizedVerificationDerivations(hcvId) : [],
          providerCheckMs: Date.now() - providerStartedAt,
          totalMs: Date.now() - startedAt,
        };
      } catch (_) {
        return {
          hcvId,
          availability: 'REFERENCE_TEMPORARILY_UNAVAILABLE',
          platform: 'r2',
          youtubeLive: false,
          r2Live: false,
          referenceLive: false,
          comparisonMode: 'R2_PRIVATE_EXACT_REFERENCE_SIGNED_V1',
          referenceVisualFingerprint: null,
          authorizedDerivations: [],
          providerCheckMs: Date.now() - providerStartedAt,
          totalMs: Date.now() - startedAt,
        };
      }
    }

    const live = await liveYoutubeReferenceStatus(reference);
    return {
      hcvId,
      ...live,
      platform: 'youtube',
      r2Live: false,
      referenceLive: live.availability === 'REFERENCE_AVAILABLE',
      comparisonMode: 'YOUTUBE_LIVE_ATTESTED_SIGNED_V3',
      referenceVisualFingerprint:
        live.availability === 'REFERENCE_AVAILABLE'
          ? reference.referenceVisualFingerprint
          : null,
      authorizedDerivations:
        live.availability === 'REFERENCE_AVAILABLE'
          ? await authorizedVerificationDerivations(hcvId)
          : [],
      totalMs: Date.now() - startedAt,
    };
  }

  async function createR2ReadAuthorization(req, hcvId) {
    if (primaryReferenceProviderName !== 'r2') {
      fail('REFERENCE_READ_AUTH_NOT_SUPPORTED', 404);
    }
    const session = await authenticate(req);
    const account = await accountEnvelope(
      session.account_id,
      session.device_key_fingerprint,
    );
    if (account.subscriptionStatus !== 'active') {
      fail('SUBSCRIPTION_REQUIRED', 402);
    }

    const reference = await activeR2Reference(hcvId);
    if (!reference) fail('REFERENCE_NOT_AVAILABLE', 404);
    const ttlSeconds = Math.max(
      15,
      Math.min(
        300,
        Number(process.env.R2_REFERENCE_READ_TTL_SECONDS || 60),
      ),
    );
    const authorization = await issueReadAuthorization(pool, {
      jobId: reference.lifecycleJobId,
      hcvId,
      accountId: session.account_id,
      ttlSeconds,
    });
    return {
      hcvId,
      platform: 'r2',
      access: 'ENTITLED',
      referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
      readPath:
        '/api/verified-originals/reference-read/' +
        encodeURIComponent(authorization.token),
      expiresAt: authorization.expiresAt,
      expiresInSeconds: authorization.expiresInSeconds,
    };
  }

  async function streamAuthorizedR2Reference(req, res, token) {
    if (primaryReferenceProviderName !== 'r2') {
      fail('REFERENCE_READ_AUTH_NOT_SUPPORTED', 404);
    }
    const session = await authenticate(req);
    const account = await accountEnvelope(
      session.account_id,
      session.device_key_fingerprint,
    );
    if (account.subscriptionStatus !== 'active') {
      fail('SUBSCRIPTION_REQUIRED', 402);
    }

    const authorization = await consumeReadAuthorization(pool, {
      token,
      accountId: session.account_id,
    });
    const reference = await activeR2Reference(authorization.hcvId);
    if (!reference ||
        reference.lifecycleJobId !== authorization.jobId ||
        !reference.providerReceipt) {
      fail('REFERENCE_NOT_AVAILABLE', 404);
    }

    const receipt = reference.providerReceipt;
    const tempRoot = String(
      process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP ||
        path.join(os.tmpdir(), 'sigillum-verified-originals'),
    );
    await fs.promises.mkdir(tempRoot, { recursive: true, mode: 0o700 });
    const tempDir = await fs.promises.mkdtemp(
      path.join(tempRoot, 'r2-read-'),
    );
    const mediaType = String(receipt.mediaType || '');
    const destinationPath = path.join(tempDir, 'reference.bin');

    try {
      await requireR2ReferenceProvider().materializeReference({
        receipt,
        destinationPath,
        binding: {
          hcvId: authorization.hcvId,
          referenceRole: receipt.referenceRole,
          referenceSha256: receipt.referenceSha256,
          originalContentSha256: receipt.originalContentSha256,
          hcvpackSha256: receipt.hcvpackSha256,
          derivationManifestSha256: receipt.derivationManifestSha256,
          objectId: receipt.objectId,
          mediaType: receipt.mediaType,
        },
      });
      const stat = await fs.promises.stat(destinationPath);
      const prefixHandle = await fs.promises.open(destinationPath, 'r');
      let prefix;
      try {
        prefix = Buffer.alloc(Math.min(16, stat.size));
        await prefixHandle.read(prefix, 0, prefix.length, 0);
      } finally {
        await prefixHandle.close();
      }

      let contentType = '';
      let extension = '';
      if (mediaType === 'video') {
        const ftyp =
          prefix.length >= 8 &&
          prefix.subarray(4, 8).toString('ascii') === 'ftyp';
        if (!ftyp) fail('REFERENCE_MEDIA_BYTES_INVALID', 422);
        contentType = 'video/mp4';
        extension = '.mp4';
      } else if (mediaType === 'photo') {
        const jpeg =
          prefix.length >= 3 &&
          prefix[0] === 0xff &&
          prefix[1] === 0xd8 &&
          prefix[2] === 0xff;
        const png =
          prefix.length >= 8 &&
          prefix.subarray(0, 8).equals(
            Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
          );
        if (jpeg) {
          contentType = 'image/jpeg';
          extension = '.jpg';
        } else if (png) {
          contentType = 'image/png';
          extension = '.png';
        } else {
          fail('REFERENCE_MEDIA_BYTES_INVALID', 422);
        }
      } else {
        fail('REFERENCE_MEDIA_TYPE_UNSUPPORTED', 415);
      }

      res.writeHead(200, {
        'content-type': contentType,
        'content-length': String(stat.size),
        'cache-control': 'private, no-store, max-age=0',
        pragma: 'no-cache',
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline; filename="sigillum-reference' +
          extension + '"',
      });
      await pipeline(fs.createReadStream(destinationPath), res);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  }

  async function publicHistory(hcvId) {
    const rows = (await pool.query(`
      SELECT publication_id,hcv_id,platform,publication_status,
             reference_role,derivation_type,source_derivation_sha256,
             subtitle_sha256,created_at,published_at,revoked_at,unavailable_at
      FROM verified_originals_publications
      WHERE hcv_id=$1
      ORDER BY published_at DESC
      LIMIT 100
    `, [hcvId])).rows;
    return rows.map(row => ({
      publicationId: row.publication_id,
      hcvId: row.hcv_id,
      platform: row.platform,
      publicationStatus: row.publication_status,
      referenceRole: row.reference_role,
      derivationType: row.derivation_type,
      sourceDerivationSha256: row.source_derivation_sha256 || null,
      subtitleSha256: row.subtitle_sha256 || null,
      createdAt: row.created_at,
      publishedAt: row.published_at,
      revokedAt: row.revoked_at,
      unavailableAt: row.unavailable_at,
      viewAccess: row.publication_status === 'PUBLISHED' ? 'SUBSCRIPTION_REQUIRED' : 'UNAVAILABLE',
      socialFileVerdict: 'NOT_VERIFIED',
    }));
  }

  async function createConsent(req) {
    const access = await creatorAccess(req);
    const payload = await readJson(req, 64_000);
    const hcvId = String(payload.hcvId || '').toUpperCase();
    if (!HCV_ID.test(hcvId)) fail('INVALID_HCV_ID', 400);
    const original = await ownedOriginal(hcvId, access.session);
    if (payload.intent !== 'PUBLISH_VERIFIED_ORIGINAL' || payload.publishReference !== true) {
      fail('EXPLICIT_PUBLICATION_CONSENT_REQUIRED', 400);
    }
    if (payload.rightsConfirmed !== true) fail('RIGHTS_NOT_CONFIRMED', 400);
    if (typeof payload.monetizationConsent !== 'boolean') fail('MONETIZATION_CONSENT_REQUIRED', 400);
    if (await activeConsent(hcvId)) fail('ACTIVE_CONSENT_ALREADY_EXISTS', 409);

    const recordId = crypto.randomUUID();
    try {
      await pool.query(`
        INSERT INTO verified_originals_consents(
          record_id,hcv_id,account_id,creator_id,session_device_fingerprint,
          consent_version,publication_consent,monetization_consent,rights_confirmed,state
        ) VALUES($1,$2,$3,$4,$5,$6,TRUE,$7,TRUE,'ACTIVE')
      `, [
        recordId,
        hcvId,
        access.session.account_id,
        original.row.creator_id,
        access.session.device_key_fingerprint,
        CONSENT_VERSION,
        payload.monetizationConsent,
      ]);
    } catch (error) {
      if (error.code === '23505') fail('ACTIVE_CONSENT_ALREADY_EXISTS', 409);
      throw error;
    }
    await audit({
      hcvId,
      eventType: 'CREATOR_CONSENT_GRANTED',
      actorType: 'CREATOR',
      actorSubjectHash: hashString(access.session.account_id),
      metadata: {
        publicationConsent: true,
        monetizationConsent: payload.monetizationConsent,
      },
    });
    return {
      ok: true,
      hcvId,
      recordId,
      consentVersion: CONSENT_VERSION,
      publicationConsent: true,
      monetizationConsent: payload.monetizationConsent,
      originalContentSha256: original.contentHash,
      publicationStatus: 'NOT_PUBLISHED',
    };
  }

  async function consentStatus(req, hcvId) {
    const session = await authenticate(req);
    await ownedOriginal(hcvId, session);
    const row = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE hcv_id=$1 AND account_id=$2
      ORDER BY consented_at DESC
      LIMIT 1
    `, [hcvId, session.account_id])).rows[0];
    if (!row) return { hcvId, consentState: 'NONE' };
    return {
      hcvId,
      consentState: row.state,
      recordId: row.record_id,
      consentVersion: row.consent_version,
      publicationConsent: row.publication_consent,
      monetizationConsent: row.monetization_consent,
      consentedAt: row.consented_at,
      withdrawnAt: row.withdrawn_at,
    };
  }

  function youtubeConfig() {
    const config = {
      clientId: String(process.env.YOUTUBE_CLIENT_ID || ''),
      clientSecret: String(process.env.YOUTUBE_CLIENT_SECRET || ''),
      refreshToken: String(process.env.YOUTUBE_REFRESH_TOKEN || ''),
      channelId: String(process.env.YOUTUBE_CHANNEL_ID || ''),
      publisherId: String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
    };
    if (!config.clientId || !config.clientSecret || !config.refreshToken || !YOUTUBE_CHANNEL_ID.test(config.channelId)) {
      fail('YOUTUBE_SERVICE_NOT_CONFIGURED', 503);
    }
    return config;
  }

  async function oauthAccessToken(config) {
    const now = Date.now();
    if (youtubeAccessTokenCache && youtubeAccessTokenExpiresAt > now + 60_000) {
      return youtubeAccessTokenCache;
    }

    let response;
    try {
      response = await fetchImpl('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          refresh_token: config.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
    } catch (_) {
      fail('YOUTUBE_OAUTH_UNAVAILABLE', 502);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.access_token !== 'string' || !payload.access_token) {
      fail('YOUTUBE_OAUTH_FAILED', 502);
    }

    const expiresInSeconds = Math.max(
      120,
      Math.min(3600, Number(payload.expires_in || 3600)),
    );
    youtubeAccessTokenCache = payload.access_token;
    youtubeAccessTokenExpiresAt = now + expiresInSeconds * 1000;
    youtubeChannelVerifiedUntil = 0;
    return youtubeAccessTokenCache;
  }

  async function verifyYoutubeChannel(accessToken, expectedChannelId) {
    const now = Date.now();
    if (youtubeChannelVerifiedId === expectedChannelId &&
        youtubeChannelVerifiedUntil > now) {
      return;
    }

    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true',
      { headers: { authorization: 'Bearer ' + accessToken } },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1 || payload.items[0]?.id !== expectedChannelId) {
      fail('YOUTUBE_CHANNEL_ID_MISMATCH', 502);
    }
    youtubeChannelVerifiedId = expectedChannelId;
    youtubeChannelVerifiedUntil =
      now + Math.max(
        60_000,
        Number(process.env.YOUTUBE_CHANNEL_VERIFY_TTL_MS || 300_000),
      );
  }

  async function startYoutubeUpload({
    accessToken,
    hcvId,
    size,
    originalSha256,
    hcvpackSha256,
    referenceRole = ORIGINAL_REFERENCE_ROLE,
    subtitleSha256 = '',
  }) {
    const endpoint = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + accessToken,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(size),
        'x-upload-content-type': 'video/mp4',
      },
      body: JSON.stringify({
        snippet: {
          title: referenceRole === DERIVED_REFERENCE_ROLE
            ? 'SIGILLUM ' + hcvId + ' SUBTITLED'
            : 'SIGILLUM ' + hcvId,
          description: [
            referenceRole === DERIVED_REFERENCE_ROLE
              ? 'SIGILLUM VERIFIED DERIVATION — SUBTITLED VIDEO'
              : 'SIGILLUM VERIFIED ORIGINAL',
            'HCV-ID: ' + hcvId,
            'Original SHA-256: ' + originalSha256,
            'HCVPACK SHA-256: ' + hcvpackSha256,
            ...(subtitleSha256 ? ['Subtitle SHA-256: ' + subtitleSha256] : []),
            'Registry: https://sigillum-hcv.com/originals/' + hcvId,
          ].join('\n'),
        },
        status: {
          privacyStatus: 'unlisted',
          embeddable: true,
          selfDeclaredMadeForKids: false,
        },
      }),
    });
    if (!response.ok) {
      const failurePayload = await response.json().catch(() => ({}));
      const failureError =
        failurePayload && typeof failurePayload === 'object'
          ? failurePayload.error
          : null;
      const failureItems = Array.isArray(failureError?.errors)
        ? failureError.errors
        : [];
      const failureReason = String(
        failureItems[0]?.reason || failureError?.status || '',
      ).slice(0, 120);
      const failureMessage = String(
        failureError?.message || '',
      ).slice(0, 240);
      console.error('[verified-originals] YouTube upload session rejected', {
        status: response.status,
        reason: failureReason,
        message: failureMessage,
      });
      fail('YOUTUBE_UPLOAD_SESSION_FAILED', 502);
    }
    const raw = String(response.headers.get('location') || '');
    let url;
    try { url = new URL(raw); } catch (_) { fail('YOUTUBE_UPLOAD_LOCATION_INVALID', 502); }
    if (url.protocol !== 'https:' || url.hostname !== 'www.googleapis.com' || !url.pathname.startsWith('/upload/youtube/v3/videos')) {
      fail('YOUTUBE_UPLOAD_LOCATION_INVALID', 502);
    }
    return url.toString();
  }

  async function uploadYoutubeFile({ accessToken, uploadUrl, filePath, size }) {
    const chunkSize = 8 * 1024 * 1024;
    const handle = await fs.promises.open(filePath, 'r');
    try {
      let offset = 0;
      while (offset < size) {
        const length = Math.min(chunkSize, size - offset);
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead !== length) fail('YOUTUBE_UPLOAD_FILE_READ_FAILED', 500);
        const end = offset + length - 1;
        const response = await fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            authorization: 'Bearer ' + accessToken,
            'content-type': 'video/mp4',
            'content-length': String(length),
            'content-range': 'bytes ' + offset + '-' + end + '/' + size,
          },
          body: buffer,
        });
        if (response.status === 308) {
          const match = /^bytes=0-(\d+)$/.exec(String(response.headers.get('range') || ''));
          if (!match) fail('YOUTUBE_UPLOAD_RANGE_INVALID', 502);
          const next = Number(match[1]) + 1;
          if (!Number.isSafeInteger(next) || next <= offset || next > size) fail('YOUTUBE_UPLOAD_RANGE_INVALID', 502);
          offset = next;
          continue;
        }
        if (!response.ok) fail('YOUTUBE_UPLOAD_FAILED', 502);
        const payload = await response.json().catch(() => ({}));
        if (!YOUTUBE_ID.test(payload.id || '') || end + 1 !== size) fail('YOUTUBE_UPLOAD_RESPONSE_INVALID', 502);
        return payload.id;
      }
    } finally {
      await handle.close();
    }
    fail('YOUTUBE_UPLOAD_INCOMPLETE', 502);
  }

  async function youtubeStatus(accessToken, videoId, allowMissing = false) {
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/videos?part=status,processingDetails&id=' + encodeURIComponent(videoId),
      { headers: { authorization: 'Bearer ' + accessToken } },
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok &&
        allowMissing &&
        Array.isArray(payload.items) &&
        payload.items.length === 0) {
      return null;
    }
    if (!response.ok || !Array.isArray(payload.items) || payload.items.length !== 1 || payload.items[0]?.id !== videoId) {
      fail('YOUTUBE_STATUS_FAILED', 502);
    }
    const item = payload.items[0];
    return {
      processingStatus: String(item.processingDetails?.processingStatus || ''),
      privacyStatus: String(item.status?.privacyStatus || ''),
      uploadStatus: String(item.status?.uploadStatus || ''),
      failureReason: String(item.status?.failureReason || ''),
      rejectionReason: String(item.status?.rejectionReason || ''),
      etag: String(item.etag || ''),
    };
  }

  async function deleteYoutubeVideo(accessToken, videoId) {
    if (!YOUTUBE_ID.test(videoId || '')) return false;
    youtubeReferenceStatusCache.delete(videoId);
    const response = await fetchImpl(
      'https://www.googleapis.com/youtube/v3/videos?id=' + encodeURIComponent(videoId),
      { method: 'DELETE', headers: { authorization: 'Bearer ' + accessToken } },
    );
    return response.status === 204 || response.status === 404 || response.ok;
  }

  async function waitYoutubeReady(accessToken, videoId) {
    const timeoutMs = Math.max(1000, Number(process.env.YOUTUBE_PROCESSING_TIMEOUT_MS || 300000));
    const pollMs = Math.max(250, Number(process.env.YOUTUBE_PROCESSING_POLL_MS || 3000));
    const deadline = Date.now() + timeoutMs;
    let last = null;
    do {
      last = await youtubeStatus(accessToken, videoId);
      if (last.processingStatus === 'succeeded' && last.privacyStatus === 'unlisted') return last;
      if (last.processingStatus === 'failed' || last.uploadStatus === 'failed' || last.rejectionReason) return last;
      if (Date.now() >= deadline) return last;
      await sleep(pollMs);
    } while (true);
  }

  async function youtubeCommentsDisabled(accessToken, videoId) {
    try {
      const response = await fetchImpl(
        'https://www.googleapis.com/youtube/v3/commentThreads?part=id&maxResults=1&videoId=' +
          encodeURIComponent(videoId),
        { headers: { authorization: 'Bearer ' + accessToken } },
      );
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return false;
      const reasons = Array.isArray(payload?.error?.errors)
        ? payload.error.errors.map(item => String(item?.reason || ''))
        : [];
      if (response.status === 403 && reasons.includes('commentsDisabled')) {
        return true;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function youtubeCommentsStatus(disabled) {
    if (disabled === true) return 'DISABLED';
    if (disabled === false) return 'ENABLED';
    return 'UNKNOWN';
  }

  async function liveYoutubeReferenceStatus(reference) {
    if (!reference || !YOUTUBE_ID.test(reference.platformPostId || '')) {
      return {
        availability: 'REFERENCE_NOT_AVAILABLE',
        youtubeLive: false,
        commentsDisabled: null,
        commentsStatus: 'UNKNOWN',
      };
    }

    const videoId = reference.platformPostId;
    const now = Date.now();
    const cached = youtubeReferenceStatusCache.get(videoId);
    if (cached && cached.expiresAt > now) {
      return {
        ...cached.value,
        youtubeCheckMs: 0,
        cacheHit: true,
      };
    }

    const startedAt = now;
    const config = youtubeConfig();
    const accessToken = await oauthAccessToken(config);
    await verifyYoutubeChannel(accessToken, config.channelId);
    const status = await youtubeStatus(accessToken, videoId, true);

    let value;
    if (!status) {
      value = {
        availability: 'REFERENCE_NOT_AVAILABLE',
        youtubeLive: false,
        commentsDisabled: null,
        commentsStatus: 'UNKNOWN',
        processingStatus: 'missing',
        privacyStatus: '',
        checkedAt: new Date().toISOString(),
      };
    } else {
      const ready =
        status.processingStatus === 'succeeded' &&
        status.privacyStatus === 'unlisted' &&
        status.uploadStatus !== 'deleted' &&
        status.uploadStatus !== 'failed';

      if (!ready) {
        value = {
          availability: 'REFERENCE_NOT_AVAILABLE',
          youtubeLive: false,
          commentsDisabled: null,
          commentsStatus: 'UNKNOWN',
          processingStatus: status.processingStatus,
          privacyStatus: status.privacyStatus,
          checkedAt: new Date().toISOString(),
        };
      } else {
        const commentsDisabled = await youtubeCommentsDisabled(
          accessToken,
          videoId,
        );
        value = {
          availability: 'REFERENCE_AVAILABLE',
          youtubeLive: true,
          commentsDisabled,
          commentsStatus: youtubeCommentsStatus(commentsDisabled),
          processingStatus: status.processingStatus,
          privacyStatus: status.privacyStatus,
          checkedAt: new Date().toISOString(),
        };
      }
    }

    const ttlMs = Math.max(
      1_000,
      Math.min(
        30_000,
        Number(process.env.YOUTUBE_REFERENCE_STATUS_TTL_MS || 5_000),
      ),
    );
    youtubeReferenceStatusCache.set(videoId, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
    if (youtubeReferenceStatusCache.size > 1000) {
      const oldestKey = youtubeReferenceStatusCache.keys().next().value;
      if (oldestKey) youtubeReferenceStatusCache.delete(oldestKey);
    }

    return {
      ...value,
      youtubeCheckMs: Date.now() - startedAt,
      cacheHit: false,
    };
  }

  async function registerReceipt({ hcvId, videoId, referenceSha256, uploadUrl, status, config }) {
    const receiptId = crypto.randomUUID();
    await pool.query(`
      INSERT INTO verified_originals_platform_receipts(
        receipt_id,hcv_id,platform,platform_post_id,uploaded_sha256,
        upload_session_hash,processing_status,visibility,publisher_subject_hash,metadata_json
      ) VALUES($1,$2,'youtube',$3,$4,$5,$6,$7,$8,$9)
    `, [
      receiptId,
      hcvId,
      videoId,
      referenceSha256,
      hashString(uploadUrl),
      status.processingStatus,
      status.privacyStatus,
      hashString(config.publisherId),
      { uploadProtocol: 'youtube_resumable_v1', youtubeEtag: status.etag, privacyStatus: status.privacyStatus },
    ]);
    return receiptId;
  }

  async function youtubePublish({
    hcvId,
    filePath,
    referenceSha256,
    size,
    originalSha256,
    hcvpackSha256,
    referenceRole = ORIGINAL_REFERENCE_ROLE,
    subtitleSha256 = '',
  }) {
    const config = youtubeConfig();
    const accessToken = await oauthAccessToken(config);
    await verifyYoutubeChannel(accessToken, config.channelId);
    const uploadUrl = await startYoutubeUpload({
      accessToken,
      hcvId,
      size,
      originalSha256,
      hcvpackSha256,
      referenceRole,
      subtitleSha256,
    });
    const videoId = await uploadYoutubeFile({ accessToken, uploadUrl, filePath, size });
    let status;
    try {
      status = await waitYoutubeReady(accessToken, videoId);
    } catch (error) {
      try { await deleteYoutubeVideo(accessToken, videoId); } catch (_) {}
      throw error;
    }
    if (status.processingStatus !== 'succeeded' || status.privacyStatus !== 'unlisted') {
      try { await deleteYoutubeVideo(accessToken, videoId); } catch (_) {}
      fail(status.privacyStatus !== 'unlisted' ? 'YOUTUBE_REFERENCE_NOT_UNLISTED' : 'YOUTUBE_PROCESSING_NOT_SUCCEEDED', 502);
    }
    const commentsDisabled = await youtubeCommentsDisabled(accessToken, videoId);
    const commentsStatus = youtubeCommentsStatus(commentsDisabled);
    const receiptId = await registerReceipt({ hcvId, videoId, referenceSha256, uploadUrl, status, config });
    return {
      videoId,
      publicUrl: canonicalYoutubeReference(videoId).publicUrl,
      receiptId,
      status,
      accessToken,
      commentsDisabled,
      commentsStatus,
    };
  }

  async function streamToFile(req, destination, expectedSize) {
    const maxBytes = Math.max(1, Number(process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912));
    const handle = await fs.promises.open(destination, 'wx', 0o600);
    const digest = crypto.createHash('sha256');
    let received = 0;
    let position = 0;
    try {
      for await (const raw of req) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        received += chunk.length;
        if (received > maxBytes || received > expectedSize) fail('ORIGINAL_UPLOAD_TOO_LARGE', 413);
        digest.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          const result = await handle.write(chunk, written, chunk.length - written, position + written);
          if (!result.bytesWritten) fail('ORIGINAL_UPLOAD_WRITE_FAILED', 500);
          written += result.bytesWritten;
        }
        position += chunk.length;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (received !== expectedSize) fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);
    return { size: received, sha256: digest.digest('hex') };
  }

  async function createExactPrimaryReferenceManifest({
    hcvId,
    original,
    originalPath,
  }) {
    const contentType =
      original.contentType || original.certificate?.content?.type;
    if (contentType !== 'video' && contentType !== 'photo') {
      fail('PRIMARY_REFERENCE_MEDIA_TYPE_UNSUPPORTED', 415);
    }
    const referenceVisualFingerprint = await buildReferenceVisualFingerprintV3({
      ffmpegPath,
      filePath: originalPath,
      mediaType: contentType,
      workDir: path.dirname(originalPath),
    });
    if (!validReferenceVisualFingerprintV3(referenceVisualFingerprint)) {
      fail('REFERENCE_VISUAL_FINGERPRINT_INVALID', 500);
    }

    const trustedKeys = parsePinnedDerivationKeys();
    const keyId = String(process.env.SIGILLUM_DERIVATION_KEY_ID || '');
    if (!trustedKeys?.[keyId]) {
      fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
    }

    const existing = (await pool.query(
      'SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1',
      [original.contentHash],
    )).rows[0];
    if (existing) {
      let manifest;
      try {
        manifest = JSON.parse(existing.manifest_raw);
      } catch (_) {
        fail('PRIMARY_REFERENCE_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      const valid =
        existing.hcv_id === hcvId &&
        verifyPrimaryReferenceManifest({
          manifest,
          certificateRaw: original.row.certificate_raw,
          trustedKeys,
        }) &&
        manifest.schema === PRIMARY_REFERENCE_SCHEMA &&
        manifest.output?.sha256 === original.contentHash &&
        manifest.output?.byteLength === original.contentSize &&
        manifest.output?.mediaType === contentType &&
        JSON.stringify(manifest.output?.referenceVisualFingerprint) ===
          JSON.stringify(referenceVisualFingerprint);
      if (!valid) {
        fail('PRIMARY_REFERENCE_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      return {
        manifest,
        outputHash: original.contentHash,
        outputSize: original.contentSize,
        manifestSha256: hashString(existing.manifest_raw),
      };
    }

    const privatePem = String(
      process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '',
    ).replace(/\\n/g, '\n');
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) || !privatePem) {
      fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
    }
    const privateKey = crypto.createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' ||
        privateKey.asymmetricKeyDetails?.modulusLength < 2048) {
      fail('DERIVATION_SIGNING_KEY_INVALID', 503);
    }
    const publicFromPrivate = crypto.createPublicKey(privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const pinned = crypto.createPublicKey(trustedKeys[keyId])
      .export({ format: 'pem', type: 'spki' })
      .toString();
    if (publicFromPrivate !== pinned) {
      fail('DERIVATION_KEY_PIN_MISMATCH', 503);
    }

    const created = createPrimaryReferenceManifest({
      hcvId,
      originalContentSha256: original.contentHash,
      byteLength: original.contentSize,
      mediaType: contentType,
      referenceVisualFingerprint,
      certificateRaw: original.row.certificate_raw,
      keyId,
      privateKeyPem: privatePem,
    });
    if (!verifyPrimaryReferenceManifest({
      manifest: created.manifest,
      certificateRaw: original.row.certificate_raw,
      trustedKeys,
    })) {
      fail('PRIMARY_REFERENCE_ATTESTATION_INVALID', 500);
    }

    await pool.query(`
      INSERT INTO trusted_derivations(output_sha256,hcv_id,manifest_raw)
      VALUES($1,$2,$3)
      ON CONFLICT(output_sha256) DO NOTHING
    `, [original.contentHash, hcvId, created.raw]);

    const stored = (await pool.query(
      'SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1',
      [original.contentHash],
    )).rows[0];
    if (!stored ||
        stored.hcv_id !== hcvId ||
        stored.manifest_raw !== created.raw) {
      fail('PRIMARY_REFERENCE_IMMUTABLE_RECORD_CONFLICT', 409);
    }
    return {
      manifest: created.manifest,
      outputHash: original.contentHash,
      outputSize: original.contentSize,
      manifestSha256: created.sha256,
    };
  }

  async function createTrustedDerivative({ hcvId, original, originalPath, outputPath }) {
    const keyId = String(process.env.SIGILLUM_DERIVATION_KEY_ID || '');
    const privatePem = String(process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '').replace(/\\n/g, '\n');
    const trustedKeys = parsePinnedDerivationKeys();
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) || !privatePem || !trustedKeys?.[keyId]) {
      fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
    }
    const privateKey = crypto.createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' || privateKey.asymmetricKeyDetails?.modulusLength < 2048) fail('DERIVATION_SIGNING_KEY_INVALID', 503);
    const publicFromPrivate = crypto.createPublicKey(privateKey).export({ format: 'pem', type: 'spki' }).toString();
    const pinned = crypto.createPublicKey(trustedKeys[keyId]).export({ format: 'pem', type: 'spki' }).toString();
    if (publicFromPrivate !== pinned) fail('DERIVATION_KEY_PIN_MISMATCH', 503);
    const contentType = original.contentType || original.certificate?.content?.type;
    const derivationOperation = contentType === 'video'
      ? DERIVATION_OPERATION
      : contentType === 'photo'
        ? PHOTO_DERIVATION_OPERATION
        : null;
    if (!derivationOperation) fail('DERIVATION_MEDIA_TYPE_UNSUPPORTED', 415);

    const ffmpegArgs = contentType === 'video'
      ? [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-i', originalPath,
          '-map', '0:v:0', '-map', '0:a?',
          '-map_metadata', '-1', '-map_chapters', '-1',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
          '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
          '-movflags', '+faststart', outputPath,
        ]
      : [
          '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
          '-loop', '1', '-i', originalPath,
          '-t', '5', '-r', '30',
          '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
          '-map_metadata', '-1', '-map_chapters', '-1',
          '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
          '-an', '-movflags', '+faststart', outputPath,
        ];

    await execFileAsync(ffmpegPath, ffmpegArgs, { timeout: 180000, maxBuffer: 4 * 1024 * 1024 });

    const output = await fs.promises.readFile(outputPath);
    if (!output.length) fail('DERIVATION_OUTPUT_INVALID', 500);
    const outputHash = hashBytes(output);
    if (outputHash === original.contentHash) fail('DERIVATION_OUTPUT_INVALID', 500);
    const referenceVisualFingerprint = await buildReferenceVisualFingerprintV3({
      ffmpegPath,
      filePath: outputPath,
      mediaType: contentType,
      workDir: path.dirname(outputPath),
    });
    if (!validReferenceVisualFingerprintV3(referenceVisualFingerprint)) {
      fail('REFERENCE_VISUAL_FINGERPRINT_INVALID', 500);
    }

    const existingDerivation = (await pool.query(
      'SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1',
      [outputHash],
    )).rows[0];
    if (existingDerivation) {
      let existingManifest;
      try {
        existingManifest = JSON.parse(existingDerivation.manifest_raw);
      } catch (_) {
        fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      const reusable =
        existingDerivation.hcv_id === hcvId &&
        verifyDerivationManifest({
          manifest: existingManifest,
          certificateRaw: original.row.certificate_raw,
          trustedKeys,
          verifyCertificateRaw,
        }) &&
        existingManifest.parent?.sha256 === original.contentHash &&
        existingManifest.output?.sha256 === outputHash &&
        existingManifest.output?.byteLength === output.length &&
        existingManifest.transform?.operation === derivationOperation &&
        JSON.stringify(existingManifest.output?.referenceVisualFingerprint) ===
          JSON.stringify(referenceVisualFingerprint);
      if (!reusable) {
        fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      return {
        manifest: existingManifest,
        outputHash,
        outputSize: output.length,
      };
    }

    const statement = {
      schema: DERIVATION_SCHEMA,
      hcvId,
      parent: {
        kind: 'original',
        sha256: original.contentHash,
        signedCertificateDigest: hashString(original.row.certificate_raw),
      },
      output: {
        sha256: outputHash,
        byteLength: output.length,
        mediaType: 'video',
        referenceVisualFingerprint,
      },
      transform: {
        operation: derivationOperation,
        editorialImpact: 'non_editorial',
        policyVersion: 'SIGILLUM_NON_EDITORIAL_V1',
      },
      issuer: { keyId, signatureAlgorithm: DERIVATION_SIGNATURE_ALGORITHM },
      createdAt: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    };
    const manifest = {
      ...statement,
      signature: crypto.sign('RSA-SHA256', Buffer.from(JSON.stringify(statement), 'utf8'), privateKey).toString('base64'),
    };
    if (!verifyDerivationManifest({ manifest, certificateRaw: original.row.certificate_raw, trustedKeys, verifyCertificateRaw })) {
      fail('DERIVATION_ATTESTATION_INVALID', 500);
    }

    const raw = JSON.stringify(manifest);
    await pool.query(`
      INSERT INTO trusted_derivations(output_sha256,hcv_id,manifest_raw)
      VALUES($1,$2,$3)
      ON CONFLICT(output_sha256) DO NOTHING
    `, [outputHash, hcvId, raw]);
    const stored = (await pool.query('SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1', [outputHash])).rows[0];
    if (!stored || stored.hcv_id !== hcvId || stored.manifest_raw !== raw) fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
    return { manifest, outputHash, outputSize: output.length };
  }

  async function createTrustedSubtitleDerivative({
    hcvId,
    original,
    captionedPath,
    outputPath,
    captionedSha256,
    subtitleSha256,
    exactReference = false,
  }) {
    if (original.contentType !== 'video' ||
        !SHA256.test(captionedSha256) ||
        !SHA256.test(subtitleSha256)) {
      fail('SUBTITLE_DERIVATION_INPUT_INVALID', 400);
    }

    const keyId = String(process.env.SIGILLUM_DERIVATION_KEY_ID || '');
    const privatePem = String(
      process.env.SIGILLUM_DERIVATION_PRIVATE_KEY_PEM || '',
    ).replace(/\\n/g, '\n');
    const trustedKeys = parsePinnedDerivationKeys();
    if (!/^[A-Za-z0-9._-]{3,80}$/.test(keyId) ||
        !privatePem ||
        !trustedKeys?.[keyId]) {
      fail('DERIVATION_SERVICE_NOT_CONFIGURED', 503);
    }

    const privateKey = crypto.createPrivateKey(privatePem);
    if (privateKey.asymmetricKeyType !== 'rsa' ||
        privateKey.asymmetricKeyDetails?.modulusLength < 2048) {
      fail('DERIVATION_SIGNING_KEY_INVALID', 503);
    }
    const publicFromPrivate = crypto.createPublicKey(privateKey)
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const pinned = crypto.createPublicKey(trustedKeys[keyId])
      .export({ format: 'pem', type: 'spki' })
      .toString();
    if (publicFromPrivate !== pinned) {
      fail('DERIVATION_KEY_PIN_MISMATCH', 503);
    }

    let referencePath = outputPath;
    let outputHash;
    let outputSize;

    if (exactReference) {
      const sourceStat = await fs.promises.stat(captionedPath);
      if (!sourceStat.isFile() || sourceStat.size <= 0) {
        fail('SUBTITLE_DERIVATION_OUTPUT_INVALID', 500);
      }
      referencePath = captionedPath;
      outputHash = captionedSha256;
      outputSize = sourceStat.size;
    } else {
      await execFileAsync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
        '-i', captionedPath,
        '-map', '0:v:0', '-map', '0:a?',
        '-map_metadata', '-1', '-map_chapters', '-1',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart',
        outputPath,
      ], {
        timeout: 180000,
        maxBuffer: 4 * 1024 * 1024,
      });

      const output = await fs.promises.readFile(outputPath);
      if (!output.length) fail('SUBTITLE_DERIVATION_OUTPUT_INVALID', 500);
      outputHash = hashBytes(output);
      outputSize = output.length;
    }

    const referenceVisualFingerprint =
      await buildReferenceVisualFingerprintV3({
        ffmpegPath,
        filePath: referencePath,
        mediaType: 'video',
        workDir: path.dirname(referencePath),
      });
    if (!validReferenceVisualFingerprintV3(referenceVisualFingerprint)) {
      fail('REFERENCE_VISUAL_FINGERPRINT_INVALID', 500);
    }

    const existingDerivation = (await pool.query(
      'SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1',
      [outputHash],
    )).rows[0];
    if (existingDerivation) {
      let existingManifest;
      try {
        existingManifest = JSON.parse(existingDerivation.manifest_raw);
      } catch (_) {
        fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      const reusable =
        existingDerivation.hcv_id === hcvId &&
        verifySubtitleDerivationManifest({
          manifest: existingManifest,
          certificateRaw: original.row.certificate_raw,
          trustedKeys,
          verifyCertificateRaw,
        }) &&
        existingManifest.parent?.sha256 === original.contentHash &&
        existingManifest.source?.sha256 === captionedSha256 &&
        existingManifest.source?.subtitleSha256 === subtitleSha256 &&
        existingManifest.output?.sha256 === outputHash &&
        existingManifest.output?.byteLength === outputSize &&
        existingManifest.transform?.operation ===
          SUBTITLE_DERIVATION_OPERATION &&
        JSON.stringify(existingManifest.output?.referenceVisualFingerprint) ===
          JSON.stringify(referenceVisualFingerprint);
      if (!reusable) {
        fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
      }
      return {
        manifest: existingManifest,
        outputHash,
        outputSize,
        referencePath,
      };
    }

    const statement = {
      schema: SUBTITLE_DERIVATION_SCHEMA,
      hcvId,
      parent: {
        kind: 'original',
        sha256: original.contentHash,
        signedCertificateDigest: hashString(original.row.certificate_raw),
      },
      source: {
        kind: 'captioned_video',
        sha256: captionedSha256,
        subtitleSha256,
      },
      output: {
        sha256: outputHash,
        byteLength: outputSize,
        mediaType: 'video',
        referenceVisualFingerprint,
      },
      transform: {
        operation: SUBTITLE_DERIVATION_OPERATION,
        editorialImpact: 'caption_overlay',
        policyVersion: SUBTITLE_DERIVATION_SCHEMA,
      },
      issuer: {
        keyId,
        signatureAlgorithm: DERIVATION_SIGNATURE_ALGORITHM,
      },
      createdAt: new Date().toISOString(),
      nonce: crypto.randomUUID(),
    };

    const manifest = {
      ...statement,
      signature: crypto.sign(
        'RSA-SHA256',
        Buffer.from(JSON.stringify(statement), 'utf8'),
        privateKey,
      ).toString('base64'),
    };

    if (!verifySubtitleDerivationManifest({
      manifest,
      certificateRaw: original.row.certificate_raw,
      trustedKeys,
      verifyCertificateRaw,
    })) {
      fail('SUBTITLE_DERIVATION_ATTESTATION_INVALID', 500);
    }

    const raw = JSON.stringify(manifest);
    await pool.query(`
      INSERT INTO trusted_derivations(output_sha256,hcv_id,manifest_raw)
      VALUES($1,$2,$3)
      ON CONFLICT(output_sha256) DO NOTHING
    `, [outputHash, hcvId, raw]);

    const stored = (await pool.query(
      'SELECT hcv_id,manifest_raw FROM trusted_derivations WHERE output_sha256=$1',
      [outputHash],
    )).rows[0];
    if (!stored ||
        stored.hcv_id !== hcvId ||
        stored.manifest_raw !== raw) {
      fail('DERIVATION_IMMUTABLE_RECORD_CONFLICT', 409);
    }

    return {
      manifest,
      outputHash,
      outputSize,
      referencePath,
    };
  }

  async function registerR2Publication({
    hcvId,
    consentRecordId,
    original,
    manifest,
    manifestSha256,
    referenceSha256,
    derivationType,
    referenceCreatedAt,
    receipt,
    lifecycleJobId,
    monetizationEnabled,
    hcvpackSha256,
    referenceRole = ORIGINAL_REFERENCE_ROLE,
    sourceDerivationSha256 = '',
    subtitleSha256 = '',
  }) {
    if (!receipt ||
        receipt.provider !== 'r2' ||
        !receipt.objectId ||
        !receipt.objectKey ||
        !SHA256.test(receipt.ciphertextSha256 || '') ||
        !SHA256.test(receipt.referenceSha256 || '') ||
        !manifest ||
        !SHA256.test(manifestSha256 || '') ||
        !SHA256.test(referenceSha256 || '') ||
        receipt.referenceSha256 !== referenceSha256 ||
        typeof derivationType !== 'string' ||
        !derivationType ||
        !Number.isFinite(Date.parse(String(referenceCreatedAt || '')))) {
      fail('PRIMARY_REFERENCE_RECEIPT_INVALID', 422);
    }
    if (referenceRole === DERIVED_REFERENCE_ROLE &&
        (!SHA256.test(sourceDerivationSha256) ||
         !SHA256.test(subtitleSha256))) {
      fail('PRIMARY_REFERENCE_DERIVATION_BINDING_INVALID', 422);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const consent = (await client.query(`
        SELECT * FROM verified_originals_consents
        WHERE record_id=$1 AND hcv_id=$2 AND state='ACTIVE'
        FOR UPDATE
      `, [consentRecordId, hcvId])).rows[0];
      if (!consent ||
          !consent.publication_consent ||
          !consent.rights_confirmed) {
        fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
      }
      if (monetizationEnabled && !consent.monetization_consent) {
        fail('MONETIZATION_NOT_AUTHORIZED', 403);
      }

      const existingPublication = (await client.query(`
        SELECT * FROM verified_originals_publications
        WHERE platform='r2' AND platform_post_id=$1
        LIMIT 1
      `, [receipt.objectId])).rows[0];
      if (existingPublication) {
        const validExisting =
          existingPublication.hcv_id === hcvId &&
          existingPublication.reference_sha256 === referenceSha256 &&
          existingPublication.original_content_sha256 ===
            original.contentHash &&
          existingPublication.hcvpack_sha256 === hcvpackSha256 &&
          existingPublication.reference_role === referenceRole &&
          existingPublication.derivation_type === derivationType &&
          existingPublication.source_derivation_sha256 ===
            sourceDerivationSha256 &&
          existingPublication.subtitle_sha256 === subtitleSha256 &&
          existingPublication.publication_status === 'PUBLISHED';
        if (!validExisting) {
          fail('PRIMARY_REFERENCE_PUBLICATION_CONFLICT', 409);
        }
        await client.query('COMMIT');
        return existingPublication.publication_id;
      }

      const receiptId = crypto.randomUUID();
      await client.query(`
        INSERT INTO verified_originals_platform_receipts(
          receipt_id,hcv_id,platform,platform_post_id,uploaded_sha256,
          upload_session_hash,processing_status,visibility,
          publisher_subject_hash,metadata_json
        ) VALUES($1,$2,'r2',$3,$4,$5,'succeeded','private',$6,$7)
        ON CONFLICT(platform,platform_post_id) DO NOTHING
      `, [
        receiptId,
        hcvId,
        receipt.objectId,
        receipt.ciphertextSha256,
        hashString(receipt.objectKey),
        hashString(
          String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
        ),
        {
          provider: 'cloudflare_r2',
          lifecycleJobId,
          objectKey: receipt.objectKey,
          ciphertextSha256: receipt.ciphertextSha256,
          ciphertextBytes: receipt.ciphertextBytes,
          encryptionFormat: receipt.encryptionFormat,
          encryptionKeyId: receipt.encryptionKeyId,
        },
      ]);

      const storedReceipt = (await client.query(`
        SELECT * FROM verified_originals_platform_receipts
        WHERE platform='r2' AND platform_post_id=$1
        LIMIT 1
      `, [receipt.objectId])).rows[0];
      if (!storedReceipt ||
          storedReceipt.hcv_id !== hcvId ||
          storedReceipt.uploaded_sha256 !== receipt.ciphertextSha256 ||
          storedReceipt.processing_status !== 'succeeded' ||
          storedReceipt.visibility !== 'private') {
        fail('PLATFORM_UPLOAD_RECEIPT_REQUIRED', 422);
      }

      const publicationId = crypto.randomUUID();
      await client.query(`
        INSERT INTO verified_originals_publications(
          publication_id,hcv_id,platform,platform_post_id,public_url,
          reference_sha256,original_content_sha256,derived_from,
          derivation_type,derivation_manifest_sha256,
          platform_receipt_id,created_at,publication_status,
          consent_record_id,consent_version,monetization_consent,
          published_by,hcvpack_sha256,reference_role,
          source_derivation_sha256,subtitle_sha256,audit_metadata_json
        ) VALUES(
          $1,$2,'r2',$3,'',$4,$5,$5,$6,$7,$8,$9,'PUBLISHED',
          $10,$11,$12,$13,$14,$15,$16,$17,$18
        )
      `, [
        publicationId,
        hcvId,
        receipt.objectId,
        referenceSha256,
        original.contentHash,
        derivationType,
        manifestSha256,
        storedReceipt.receipt_id,
        referenceCreatedAt,
        consentRecordId,
        consent.consent_version,
        monetizationEnabled,
        String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
        hcvpackSha256,
        referenceRole,
        sourceDerivationSha256,
        subtitleSha256,
        {
          provider: 'r2',
          lifecycleJobId,
          referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
          manifestSchema: manifest.schema || null,
        },
      ]);

      await audit({
        hcvId,
        publicationId,
        eventType: 'PRIMARY_REFERENCE_COMMITTED',
        actorType: 'SIGILLUM_PUBLISHER',
        actorSubjectHash: hashString(
          String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
        ),
        metadata: {
          provider: 'r2',
          lifecycleJobId,
          referenceRole,
          derivationType,
          sourceDerivationSha256: sourceDerivationSha256 || null,
          subtitleSha256: subtitleSha256 || null,
          hcvpackSha256,
          ciphertextSha256: receipt.ciphertextSha256,
          encryptionFormat: receipt.encryptionFormat,
          encryptionKeyId: receipt.encryptionKeyId,
        },
        client,
      });

      await client.query('COMMIT');
      return publicationId;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
  }

  async function registerPublication({
    hcvId,
    consentRecordId,
    original,
    derivation,
    youtube,
    monetizationEnabled,
    hcvpackSha256,
    referenceRole = ORIGINAL_REFERENCE_ROLE,
    sourceDerivationSha256 = '',
    subtitleSha256 = '',
  }) {
    const client = await pool.connect();
    const publicationId = crypto.randomUUID();
    try {
      await client.query('BEGIN');
      const consent = (await client.query(`
        SELECT * FROM verified_originals_consents
        WHERE record_id=$1 AND hcv_id=$2 AND state='ACTIVE'
        FOR UPDATE
      `, [consentRecordId, hcvId])).rows[0];
      if (!consent || !consent.publication_consent || !consent.rights_confirmed) fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
      if (monetizationEnabled && !consent.monetization_consent) fail('MONETIZATION_NOT_AUTHORIZED', 403);
      const receipt = (await client.query('SELECT * FROM verified_originals_platform_receipts WHERE receipt_id=$1', [youtube.receiptId])).rows[0];
      if (!receipt || receipt.hcv_id !== hcvId || receipt.platform !== 'youtube' || receipt.platform_post_id !== youtube.videoId || receipt.uploaded_sha256 !== derivation.outputHash || receipt.processing_status !== 'succeeded' || receipt.visibility !== 'unlisted') {
        fail('PLATFORM_UPLOAD_RECEIPT_REQUIRED', 422);
      }
      const manifestRaw = JSON.stringify(derivation.manifest);
      await client.query(`
        INSERT INTO verified_originals_publications(
          publication_id,hcv_id,platform,platform_post_id,public_url,
          reference_sha256,original_content_sha256,derived_from,derivation_type,
          derivation_manifest_sha256,platform_receipt_id,created_at,publication_status,
          consent_record_id,consent_version,monetization_consent,published_by,hcvpack_sha256,
          reference_role,source_derivation_sha256,subtitle_sha256
        ) VALUES($1,$2,'youtube',$3,$4,$5,$6,$6,$7,$8,$9,$10,'PUBLISHED',$11,$12,$13,$14,$15,$16,$17,$18)
      `, [
        publicationId,
        hcvId,
        youtube.videoId,
        youtube.publicUrl,
        derivation.outputHash,
        original.contentHash,
        derivation.manifest.transform.operation,
        hashString(manifestRaw),
        youtube.receiptId,
        derivation.manifest.createdAt,
        consentRecordId,
        consent.consent_version,
        monetizationEnabled,
        String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
        hcvpackSha256,
        referenceRole,
        sourceDerivationSha256,
        subtitleSha256,
      ]);
      await audit({
        hcvId,
        publicationId,
        eventType: 'PUBLICATION_REGISTERED',
        actorType: 'SIGILLUM_PUBLISHER',
        actorSubjectHash: hashString(String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1')),
        metadata: {
          platformStatus: youtube.status.processingStatus,
          platformVisibility: youtube.status.privacyStatus,
          workerVersion: 'verified_originals_production_v2',
          hcvpackSha256,
          referenceRole,
          sourceDerivationSha256: sourceDerivationSha256 || null,
          subtitleSha256: subtitleSha256 || null,
        },
        client,
      });
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }
    return publicationId;
  }

  async function publishOriginalYoutube(req, hcvId, url) {
    const access = await creatorAccess(req);
    const original = await ownedOriginal(hcvId, access.session);
    const requestMediaType = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowedMediaTypes = original.contentType === 'video'
      ? new Set(['video/mp4'])
      : new Set(['image/jpeg', 'image/png']);
    if (!allowedMediaTypes.has(requestMediaType)) fail('ORIGINAL_MEDIA_TYPE_UNSUPPORTED', 415);
    const contentLength = Number(req.headers['content-length']);
    const maxBytes = Math.max(1, Number(process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0 || contentLength > maxBytes) fail('ORIGINAL_CONTENT_LENGTH_INVALID', 411);
    if (contentLength !== original.contentSize) fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);

    const consentRecordId = String(url.searchParams.get('consentRecordId') || '');
    const monetizationEnabled = strictBoolean(url.searchParams.get('monetizationEnabled'));
    const hcvpackSha256 = String(url.searchParams.get('hcvpackSha256') || '').toLowerCase();
    if (!consentRecordId || monetizationEnabled === null || !SHA256.test(hcvpackSha256)) fail('PUBLISH_REQUEST_INVALID', 400);
    if (!verifyHcvpackBindingSignature(req, original, hcvId, hcvpackSha256)) {
      fail('HCVPACK_BINDING_SIGNATURE_INVALID', 422);
    }
    const consent = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE record_id=$1 AND hcv_id=$2 AND account_id=$3 AND state='ACTIVE'
    `, [consentRecordId, hcvId, access.session.account_id])).rows[0];
    if (!consent || !consent.publication_consent || !consent.rights_confirmed) fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
    if (monetizationEnabled && !consent.monetization_consent) fail('MONETIZATION_NOT_AUTHORIZED', 403);

    const tmpRoot = String(process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP || path.join(os.tmpdir(), 'sigillum-verified-originals'));
    await fs.promises.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const jobDir = await fs.promises.mkdtemp(path.join(tmpRoot, 'job-'));
    const originalExtension = original.contentType === 'video'
      ? '.mp4'
      : requestMediaType === 'image/png'
        ? '.png'
        : '.jpg';
    const originalPath = path.join(jobDir, 'original' + originalExtension);
    const outputPath = path.join(jobDir, 'reference.mp4');

    try {
      const uploaded = await streamToFile(req, originalPath, original.contentSize);
      if (uploaded.sha256 !== original.contentHash) fail('DERIVATION_ORIGINAL_SHA_MISMATCH', 422);
      const derivation = await createTrustedDerivative({ hcvId, original, originalPath, outputPath });
      const youtube = await youtubePublish({
        hcvId,
        filePath: outputPath,
        referenceSha256: derivation.outputHash,
        size: derivation.outputSize,
        originalSha256: original.contentHash,
        hcvpackSha256,
      });
      let publicationId;
      try {
        publicationId = await registerPublication({ hcvId, consentRecordId, original, derivation, youtube, monetizationEnabled, hcvpackSha256 });
      } catch (error) {
        try { await deleteYoutubeVideo(youtube.accessToken, youtube.videoId); } catch (_) {}
        try {
          await pool.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='registration_failed',visibility='unavailable',verified_at=NOW()
            WHERE receipt_id=$1
          `, [youtube.receiptId]);
        } catch (_) {}
        throw error;
      }
      return {
        ok: true,
        publicationId,
        hcvId,
        platform: 'youtube',
        publicUrl: youtube.publicUrl,
        publicationStatus: 'PUBLISHED',
        originalContentSha256: original.contentHash,
        referenceSha256: derivation.outputHash,
        derivedFrom: original.contentHash,
        derivationType: derivation.manifest.transform.operation,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    } finally {
      for (const item of [outputPath + '.hcvderivation.json', outputPath, originalPath]) {
        try { await fs.promises.rm(item, { force: true }); } catch (_) {}
      }
      try { await fs.promises.rmdir(jobDir); } catch (_) {}
    }
  }

  async function publishOriginalR2(req, hcvId, url) {
    const access = await creatorAccess(req);
    const original = await ownedOriginal(hcvId, access.session);
    const requestMediaType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .toLowerCase();
    const allowedMediaTypes = original.contentType === 'video'
      ? new Set(['video/mp4'])
      : new Set(['image/jpeg', 'image/png']);
    if (!allowedMediaTypes.has(requestMediaType)) {
      fail('ORIGINAL_MEDIA_TYPE_UNSUPPORTED', 415);
    }

    const contentLength = Number(req.headers['content-length']);
    const maxBytes = Math.max(
      1,
      Number(
        process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912,
      ),
    );
    if (!Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > maxBytes) {
      fail('ORIGINAL_CONTENT_LENGTH_INVALID', 411);
    }
    if (contentLength !== original.contentSize) {
      fail('ORIGINAL_UPLOAD_SIZE_MISMATCH', 400);
    }

    const consentRecordId = String(
      url.searchParams.get('consentRecordId') || '',
    );
    const monetizationEnabled = strictBoolean(
      url.searchParams.get('monetizationEnabled'),
    );
    const hcvpackSha256 = String(
      url.searchParams.get('hcvpackSha256') || '',
    ).toLowerCase();
    if (!consentRecordId ||
        monetizationEnabled === null ||
        !SHA256.test(hcvpackSha256)) {
      fail('PUBLISH_REQUEST_INVALID', 400);
    }
    if (!verifyHcvpackBindingSignature(
      req,
      original,
      hcvId,
      hcvpackSha256,
    )) {
      fail('HCVPACK_BINDING_SIGNATURE_INVALID', 422);
    }

    const consent = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE record_id=$1
        AND hcv_id=$2
        AND account_id=$3
        AND state='ACTIVE'
    `, [
      consentRecordId,
      hcvId,
      access.session.account_id,
    ])).rows[0];
    if (!consent ||
        !consent.publication_consent ||
        !consent.rights_confirmed) {
      fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
    }
    if (monetizationEnabled && !consent.monetization_consent) {
      fail('MONETIZATION_NOT_AUTHORIZED', 403);
    }

    const tmpRoot = String(
      process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP ||
        path.join(os.tmpdir(), 'sigillum-verified-originals'),
    );
    await fs.promises.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const jobDir = await fs.promises.mkdtemp(
      path.join(tmpRoot, 'r2-primary-job-'),
    );
    const originalExtension = original.contentType === 'video'
      ? '.mp4'
      : requestMediaType === 'image/png'
        ? '.png'
        : '.jpg';
    const originalPath = path.join(jobDir, 'original' + originalExtension);

    try {
      const uploaded = await streamToFile(
        req,
        originalPath,
        original.contentSize,
      );
      if (uploaded.sha256 !== original.contentHash) {
        fail('PRIMARY_REFERENCE_ORIGINAL_SHA_MISMATCH', 422);
      }

      const primaryManifest = await createExactPrimaryReferenceManifest({
        hcvId,
        original,
        originalPath,
      });
      const objectId = crypto.randomUUID();
      const objectKey = opaqueObjectKey(objectId);
      const binding = {
        hcvId,
        referenceRole: ORIGINAL_REFERENCE_ROLE,
        referenceSha256: primaryManifest.outputHash,
        originalContentSha256: original.contentHash,
        hcvpackSha256,
        derivationManifestSha256: primaryManifest.manifestSha256,
        mediaType: original.contentType,
      };

      const lifecycle = await createOrGetReferenceJob(pool, {
        binding,
        provider: 'r2',
        objectId,
        objectKey,
      });
      let lifecycleJob = lifecycle.job;
      let receipt = lifecycleJob.receipt;

      if (lifecycleJob.state !== 'COMMITTED') {
        try {
          lifecycleJob = await claimUploadJob(pool, lifecycleJob.jobId);
        } catch (error) {
          if (String(error?.message || '') ===
              'PRIMARY_REFERENCE_UPLOAD_STATE_CONFLICT') {
            fail('PRIMARY_REFERENCE_UPLOAD_IN_PROGRESS', 409);
          }
          throw error;
        }

        if (lifecycleJob.state !== 'COMMITTED') {
          const provider = requireR2ReferenceProvider();
          try {
            receipt = await provider.commitReference({
              sourcePath: originalPath,
              hcvId,
              referenceRole: ORIGINAL_REFERENCE_ROLE,
              referenceSha256: primaryManifest.outputHash,
              originalContentSha256: original.contentHash,
              hcvpackSha256,
              derivationManifestSha256:
                primaryManifest.manifestSha256,
              mediaType: original.contentType,
              objectId: lifecycleJob.objectId,
              objectKey: lifecycleJob.objectKey,
            });
          } catch (error) {
            try {
              await markUploadRetry(
                pool,
                lifecycleJob.jobId,
                'R2_PROVIDER_TEMPORARY_FAILURE',
              );
            } catch (_) {}
            console.error(
              '[verified-originals] R2 primary reference commit failed',
              String(error?.message || error),
            );
            fail('PRIMARY_REFERENCE_PROVIDER_UNAVAILABLE', 503);
          }
          lifecycleJob = await markPrimaryReferenceCommitted(
            pool,
            lifecycleJob.jobId,
            receipt,
          );
        } else {
          receipt = lifecycleJob.receipt;
        }
      }

      if (!receipt) {
        receipt = lifecycleJob.receipt;
      }
      if (!receipt ||
          receipt.derivationManifestSha256 !==
            primaryManifest.manifestSha256 ||
          receipt.referenceSha256 !== primaryManifest.outputHash ||
          receipt.hcvpackSha256 !== hcvpackSha256) {
        fail('PRIMARY_REFERENCE_RECEIPT_BINDING_MISMATCH', 422);
      }

      let publicationId;
      try {
        publicationId = await registerR2Publication({
          hcvId,
          consentRecordId,
          original,
          manifest: primaryManifest.manifest,
          manifestSha256: primaryManifest.manifestSha256,
          referenceSha256: primaryManifest.outputHash,
          derivationType: PRIMARY_REFERENCE_OPERATION,
          referenceCreatedAt: primaryManifest.manifest.createdAt,
          receipt,
          lifecycleJobId: lifecycleJob.jobId,
          monetizationEnabled,
          hcvpackSha256,
        });
      } catch (error) {
        await cleanupUnregisteredR2Reference({
          hcvId,
          receipt,
          lifecycleJobId: lifecycleJob.jobId,
        });
        throw error;
      }

      return {
        ok: true,
        alreadyAvailable: !lifecycle.created,
        publicationId,
        hcvId,
        platform: 'r2',
        publicationStatus: 'PUBLISHED',
        referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
        originalContentSha256: original.contentHash,
        referenceSha256: primaryManifest.outputHash,
        derivedFrom: original.contentHash,
        derivationType: PRIMARY_REFERENCE_OPERATION,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    } finally {
      try {
        await fs.promises.rm(originalPath, { force: true });
      } catch (_) {}
      try {
        await fs.promises.rmdir(jobDir);
      } catch (_) {}
    }
  }

  async function publishOriginal(req, hcvId, url) {
    if (primaryReferenceProviderName === 'r2') {
      return publishOriginalR2(req, hcvId, url);
    }
    return publishOriginalYoutube(req, hcvId, url);
  }

  async function publishSubtitleDerivativeYoutube(req, hcvId, url) {
    const access = await creatorAccess(req);
    const original = await ownedOriginal(hcvId, access.session);
    if (original.contentType !== 'video') {
      fail('SUBTITLE_DERIVATION_REQUIRES_VIDEO', 415);
    }

    const originalReference = await activeReference(hcvId);
    if (!originalReference) {
      fail('ORIGINAL_REFERENCE_REQUIRED', 409);
    }

    const requestMediaType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .toLowerCase();
    if (requestMediaType !== 'video/mp4') {
      fail('SUBTITLE_DERIVATION_MEDIA_TYPE_UNSUPPORTED', 415);
    }

    const contentLength = Number(req.headers['content-length']);
    const maxBytes = Math.max(
      1,
      Number(
        process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912,
      ),
    );
    if (!Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > maxBytes) {
      fail('SUBTITLE_DERIVATION_CONTENT_LENGTH_INVALID', 411);
    }

    const consentRecordId = String(
      url.searchParams.get('consentRecordId') || '',
    );
    const monetizationEnabled = strictBoolean(
      url.searchParams.get('monetizationEnabled'),
    );
    const hcvpackSha256 = String(
      url.searchParams.get('hcvpackSha256') || '',
    ).toLowerCase();
    const subtitleSha256 = String(
      url.searchParams.get('subtitleSha256') || '',
    ).toLowerCase();
    const captionedSha256 = String(
      req.headers['x-sigillum-captioned-sha256'] || '',
    ).toLowerCase();

    if (!consentRecordId ||
        monetizationEnabled === null ||
        !SHA256.test(hcvpackSha256) ||
        !SHA256.test(subtitleSha256) ||
        !SHA256.test(captionedSha256)) {
      fail('SUBTITLE_DERIVATION_REQUEST_INVALID', 400);
    }

    const existing = await activeSubtitleReference(
      hcvId,
      captionedSha256,
      subtitleSha256,
    );
    if (existing) {
      return {
        ok: true,
        alreadyAvailable: true,
        ...existing,
        hcvpackSha256,
      };
    }

    if (!verifySubtitleDerivationBindingSignature(
      req,
      original,
      hcvId,
      captionedSha256,
      subtitleSha256,
      hcvpackSha256,
    )) {
      fail('SUBTITLE_DERIVATION_BINDING_SIGNATURE_INVALID', 422);
    }

    const consent = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE record_id=$1
        AND hcv_id=$2
        AND account_id=$3
        AND state='ACTIVE'
    `, [
      consentRecordId,
      hcvId,
      access.session.account_id,
    ])).rows[0];
    if (!consent ||
        !consent.publication_consent ||
        !consent.rights_confirmed) {
      fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
    }
    if (monetizationEnabled && !consent.monetization_consent) {
      fail('MONETIZATION_NOT_AUTHORIZED', 403);
    }

    const tmpRoot = String(
      process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP ||
        path.join(os.tmpdir(), 'sigillum-verified-originals'),
    );
    await fs.promises.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const jobDir = await fs.promises.mkdtemp(
      path.join(tmpRoot, 'subtitle-job-'),
    );
    const captionedPath = path.join(jobDir, 'captioned-source.mp4');
    const outputPath = path.join(jobDir, 'reference-subtitled.mp4');

    try {
      const uploaded = await streamToFile(
        req,
        captionedPath,
        contentLength,
      );
      if (uploaded.sha256 !== captionedSha256) {
        fail('SUBTITLE_DERIVATION_SHA_MISMATCH', 422);
      }

      const derivation = await createTrustedSubtitleDerivative({
        hcvId,
        original,
        captionedPath,
        outputPath,
        captionedSha256,
        subtitleSha256,
      });

      const youtube = await youtubePublish({
        hcvId,
        filePath: outputPath,
        referenceSha256: derivation.outputHash,
        size: derivation.outputSize,
        originalSha256: original.contentHash,
        hcvpackSha256,
        referenceRole: DERIVED_REFERENCE_ROLE,
        subtitleSha256,
      });

      let publicationId;
      try {
        publicationId = await registerPublication({
          hcvId,
          consentRecordId,
          original,
          derivation,
          youtube,
          monetizationEnabled,
          hcvpackSha256,
          referenceRole: DERIVED_REFERENCE_ROLE,
          sourceDerivationSha256: captionedSha256,
          subtitleSha256,
        });
      } catch (error) {
        try {
          await deleteYoutubeVideo(youtube.accessToken, youtube.videoId);
        } catch (_) {}
        try {
          await pool.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='registration_failed',
                visibility='unavailable',
                verified_at=NOW()
            WHERE receipt_id=$1
          `, [youtube.receiptId]);
        } catch (_) {}
        throw error;
      }

      return {
        ok: true,
        alreadyAvailable: false,
        publicationId,
        hcvId,
        platform: 'youtube',
        publicUrl: youtube.publicUrl,
        publicationStatus: 'PUBLISHED',
        referenceRole: DERIVED_REFERENCE_ROLE,
        originalContentSha256: original.contentHash,
        sourceDerivationSha256: captionedSha256,
        subtitleSha256,
        referenceSha256: derivation.outputHash,
        derivedFrom: original.contentHash,
        derivationType: SUBTITLE_DERIVATION_OPERATION,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    } finally {
      for (const item of [
        outputPath + '.hcvderivation.json',
        outputPath,
        captionedPath,
      ]) {
        try {
          await fs.promises.rm(item, { force: true });
        } catch (_) {}
      }
      try {
        await fs.promises.rmdir(jobDir);
      } catch (_) {}
    }
  }

  async function publishSubtitleDerivativeR2(req, hcvId, url) {
    const access = await creatorAccess(req);
    const original = await ownedOriginal(hcvId, access.session);
    if (original.contentType !== 'video') {
      fail('SUBTITLE_DERIVATION_REQUIRES_VIDEO', 415);
    }

    const originalReference = await activeReference(hcvId);
    if (!originalReference || originalReference.platform !== 'r2') {
      fail('ORIGINAL_REFERENCE_REQUIRED', 409);
    }

    const requestMediaType = String(req.headers['content-type'] || '')
      .split(';')[0]
      .toLowerCase();
    if (requestMediaType !== 'video/mp4') {
      fail('SUBTITLE_DERIVATION_MEDIA_TYPE_UNSUPPORTED', 415);
    }

    const contentLength = Number(req.headers['content-length']);
    const maxBytes = Math.max(
      1,
      Number(
        process.env.SIGILLUM_VERIFIED_ORIGINALS_MAX_BYTES || 536870912,
      ),
    );
    if (!Number.isSafeInteger(contentLength) ||
        contentLength <= 0 ||
        contentLength > maxBytes) {
      fail('SUBTITLE_DERIVATION_CONTENT_LENGTH_INVALID', 411);
    }

    const consentRecordId = String(
      url.searchParams.get('consentRecordId') || '',
    );
    const monetizationEnabled = strictBoolean(
      url.searchParams.get('monetizationEnabled'),
    );
    const hcvpackSha256 = String(
      url.searchParams.get('hcvpackSha256') || '',
    ).toLowerCase();
    const subtitleSha256 = String(
      url.searchParams.get('subtitleSha256') || '',
    ).toLowerCase();
    const captionedSha256 = String(
      req.headers['x-sigillum-captioned-sha256'] || '',
    ).toLowerCase();

    if (!consentRecordId ||
        monetizationEnabled === null ||
        !SHA256.test(hcvpackSha256) ||
        !SHA256.test(subtitleSha256) ||
        !SHA256.test(captionedSha256)) {
      fail('SUBTITLE_DERIVATION_REQUEST_INVALID', 400);
    }

    const existing = await activeSubtitleReference(
      hcvId,
      captionedSha256,
      subtitleSha256,
    );
    if (existing) {
      return {
        ok: true,
        alreadyAvailable: true,
        publicationId: existing.publicationId,
        hcvId,
        platform: 'r2',
        publicationStatus: existing.publicationStatus,
        referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
        referenceRole: existing.referenceRole,
        originalContentSha256: existing.originalContentSha256,
        sourceDerivationSha256: existing.sourceDerivationSha256,
        subtitleSha256: existing.subtitleSha256,
        referenceSha256: existing.referenceSha256,
        derivedFrom: original.contentHash,
        derivationType: existing.derivationType,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    }

    if (!verifySubtitleDerivationBindingSignature(
      req,
      original,
      hcvId,
      captionedSha256,
      subtitleSha256,
      hcvpackSha256,
    )) {
      fail('SUBTITLE_DERIVATION_BINDING_SIGNATURE_INVALID', 422);
    }

    const consent = (await pool.query(`
      SELECT * FROM verified_originals_consents
      WHERE record_id=$1
        AND hcv_id=$2
        AND account_id=$3
        AND state='ACTIVE'
    `, [
      consentRecordId,
      hcvId,
      access.session.account_id,
    ])).rows[0];
    if (!consent ||
        !consent.publication_consent ||
        !consent.rights_confirmed) {
      fail('ACTIVE_CREATOR_CONSENT_REQUIRED', 403);
    }
    if (monetizationEnabled && !consent.monetization_consent) {
      fail('MONETIZATION_NOT_AUTHORIZED', 403);
    }

    const tmpRoot = String(
      process.env.SIGILLUM_VERIFIED_ORIGINALS_TMP ||
        path.join(os.tmpdir(), 'sigillum-verified-originals'),
    );
    await fs.promises.mkdir(tmpRoot, { recursive: true, mode: 0o700 });
    const jobDir = await fs.promises.mkdtemp(
      path.join(tmpRoot, 'r2-subtitle-job-'),
    );
    const captionedPath = path.join(jobDir, 'captioned-source.mp4');
    const outputPath = path.join(jobDir, 'reference-subtitled.mp4');

    try {
      const uploaded = await streamToFile(
        req,
        captionedPath,
        contentLength,
      );
      if (uploaded.sha256 !== captionedSha256) {
        fail('SUBTITLE_DERIVATION_SHA_MISMATCH', 422);
      }

      const derivation = await createTrustedSubtitleDerivative({
        hcvId,
        original,
        captionedPath,
        outputPath,
        captionedSha256,
        subtitleSha256,
        exactReference: true,
      });
      const manifestRaw = JSON.stringify(derivation.manifest);
      const manifestSha256 = hashString(manifestRaw);
      const objectId = crypto.randomUUID();
      const objectKey = opaqueObjectKey(objectId);
      const binding = {
        hcvId,
        referenceRole: DERIVED_REFERENCE_ROLE,
        referenceSha256: derivation.outputHash,
        originalContentSha256: original.contentHash,
        hcvpackSha256,
        derivationManifestSha256: manifestSha256,
        mediaType: 'video',
      };

      const lifecycle = await createOrGetReferenceJob(pool, {
        binding,
        provider: 'r2',
        objectId,
        objectKey,
      });
      let lifecycleJob = lifecycle.job;
      let receipt = lifecycleJob.receipt;

      if (lifecycleJob.state !== 'COMMITTED') {
        try {
          lifecycleJob = await claimUploadJob(pool, lifecycleJob.jobId);
        } catch (error) {
          if (String(error?.message || '') ===
              'PRIMARY_REFERENCE_UPLOAD_STATE_CONFLICT') {
            fail('PRIMARY_REFERENCE_UPLOAD_IN_PROGRESS', 409);
          }
          throw error;
        }

        if (lifecycleJob.state !== 'COMMITTED') {
          try {
            receipt = await requireR2ReferenceProvider().commitReference({
              sourcePath: derivation.referencePath,
              hcvId,
              referenceRole: DERIVED_REFERENCE_ROLE,
              referenceSha256: derivation.outputHash,
              originalContentSha256: original.contentHash,
              hcvpackSha256,
              derivationManifestSha256: manifestSha256,
              mediaType: 'video',
              objectId: lifecycleJob.objectId,
              objectKey: lifecycleJob.objectKey,
            });
          } catch (error) {
            try {
              await markUploadRetry(
                pool,
                lifecycleJob.jobId,
                'R2_PROVIDER_TEMPORARY_FAILURE',
              );
            } catch (_) {}
            console.error(
              '[verified-originals] R2 subtitle reference commit failed',
              String(error?.message || error),
            );
            fail('PRIMARY_REFERENCE_PROVIDER_UNAVAILABLE', 503);
          }
          lifecycleJob = await markPrimaryReferenceCommitted(
            pool,
            lifecycleJob.jobId,
            receipt,
          );
        } else {
          receipt = lifecycleJob.receipt;
        }
      }

      if (!receipt) receipt = lifecycleJob.receipt;
      if (!receipt ||
          receipt.derivationManifestSha256 !== manifestSha256 ||
          receipt.referenceSha256 !== derivation.outputHash ||
          receipt.hcvpackSha256 !== hcvpackSha256) {
        fail('PRIMARY_REFERENCE_RECEIPT_BINDING_MISMATCH', 422);
      }

      let publicationId;
      try {
        publicationId = await registerR2Publication({
          hcvId,
          consentRecordId,
          original,
          manifest: derivation.manifest,
          manifestSha256,
          referenceSha256: derivation.outputHash,
          derivationType: SUBTITLE_DERIVATION_OPERATION,
          referenceCreatedAt: derivation.manifest.createdAt,
          receipt,
          lifecycleJobId: lifecycleJob.jobId,
          monetizationEnabled,
          hcvpackSha256,
          referenceRole: DERIVED_REFERENCE_ROLE,
          sourceDerivationSha256: captionedSha256,
          subtitleSha256,
        });
      } catch (error) {
        await cleanupUnregisteredR2Reference({
          hcvId,
          receipt,
          lifecycleJobId: lifecycleJob.jobId,
        });
        throw error;
      }

      return {
        ok: true,
        alreadyAvailable: !lifecycle.created,
        publicationId,
        hcvId,
        platform: 'r2',
        publicationStatus: 'PUBLISHED',
        referenceAccess: 'SHORT_LIVED_AUTHORIZATION',
        referenceRole: DERIVED_REFERENCE_ROLE,
        originalContentSha256: original.contentHash,
        sourceDerivationSha256: captionedSha256,
        subtitleSha256,
        referenceSha256: derivation.outputHash,
        derivedFrom: original.contentHash,
        derivationType: SUBTITLE_DERIVATION_OPERATION,
        hcvpackSha256,
        socialFileVerdict: 'NOT_VERIFIED',
      };
    } finally {
      for (const item of [
        outputPath + '.hcvderivation.json',
        outputPath,
        captionedPath,
      ]) {
        try {
          await fs.promises.rm(item, { force: true });
        } catch (_) {}
      }
      try {
        await fs.promises.rmdir(jobDir);
      } catch (_) {}
    }
  }

  async function publishSubtitleDerivative(req, hcvId, url) {
    if (primaryReferenceProviderName === 'r2') {
      return publishSubtitleDerivativeR2(req, hcvId, url);
    }
    return publishSubtitleDerivativeYoutube(req, hcvId, url);
  }

  async function cleanupUnregisteredR2Reference({
    hcvId,
    receipt,
    lifecycleJobId,
  }) {
    if (!receipt?.objectId || !lifecycleJobId) return 'PENDING';
    let job;
    try {
      job = await requestDeleteByProviderObject(pool, {
        provider: 'r2',
        objectId: receipt.objectId,
        hcvId,
      });
    } catch (_) {
      job = await referenceJobByProviderObject(pool, {
        provider: 'r2',
        objectId: receipt.objectId,
        hcvId,
      });
    }
    if (!job) return 'PENDING';
    if (job.state === 'DELETED') return 'COMPLETED';
    if (job.state !== 'DELETE_PENDING') return 'PENDING';

    try {
      job = await claimDeleteJob(pool, lifecycleJobId);
    } catch (_) {
      return 'PENDING';
    }
    if (job.state === 'DELETED') return 'COMPLETED';

    try {
      const result = await requireR2ReferenceProvider()
        .deleteReference(job.receipt);
      if (!result?.deleted) {
        await markDeleteRetry(
          pool,
          job.jobId,
          'R2_DELETE_NOT_CONFIRMED',
        );
        return 'PENDING';
      }
      await markPrimaryReferenceDeleted(pool, job.jobId);
      return 'COMPLETED';
    } catch (_) {
      try {
        await markDeleteRetry(
          pool,
          job.jobId,
          'R2_DELETE_PROVIDER_UNAVAILABLE',
        );
      } catch (_) {}
      return 'PENDING';
    }
  }

  async function markPlatformReceiptWithdrawn(receiptId) {
    await pool.query(`
      UPDATE verified_originals_platform_receipts
      SET processing_status='withdrawn',
          visibility='unavailable',
          verified_at=NOW()
      WHERE receipt_id=$1
    `, [receiptId]);
  }

  async function attemptR2Takedown(publication) {
    let job = await referenceJobByProviderObject(pool, {
      provider: 'r2',
      objectId: publication.platform_post_id,
      hcvId: publication.hcv_id,
    });
    if (!job) return false;

    if (job.state === 'COMMITTED') {
      job = await requestDeleteByProviderObject(pool, {
        provider: 'r2',
        objectId: publication.platform_post_id,
        hcvId: publication.hcv_id,
      });
    }
    if (job.state === 'DELETED') {
      await markPlatformReceiptWithdrawn(publication.platform_receipt_id);
      return true;
    }
    if (job.state !== 'DELETE_PENDING') return false;

    try {
      job = await claimDeleteJob(pool, job.jobId);
    } catch (error) {
      if (String(error?.message || '') ===
          'PRIMARY_REFERENCE_DELETE_STATE_CONFLICT') {
        return false;
      }
      throw error;
    }
    if (job.state === 'DELETED') {
      await markPlatformReceiptWithdrawn(publication.platform_receipt_id);
      return true;
    }

    try {
      const deleted = await requireR2ReferenceProvider()
        .deleteReference(job.receipt);
      if (!deleted?.deleted) {
        await markDeleteRetry(
          pool,
          job.jobId,
          'R2_DELETE_NOT_CONFIRMED',
        );
        return false;
      }
      await markPrimaryReferenceDeleted(pool, job.jobId);
      await markPlatformReceiptWithdrawn(publication.platform_receipt_id);
      return true;
    } catch (error) {
      try {
        await markDeleteRetry(
          pool,
          job.jobId,
          'R2_DELETE_PROVIDER_UNAVAILABLE',
        );
      } catch (_) {}
      console.error(
        '[verified-originals] R2 primary reference delete deferred',
        String(error?.message || error),
      );
      return false;
    }
  }

  async function attemptYoutubeTakedown(publication, youtubeState) {
    if (!youtubeServiceConfigured()) return false;
    if (!youtubeState.accessToken) {
      const config = youtubeConfig();
      youtubeState.accessToken = await oauthAccessToken(config);
      await verifyYoutubeChannel(youtubeState.accessToken, config.channelId);
    }
    const deleted = await deleteYoutubeVideo(
      youtubeState.accessToken,
      publication.platform_post_id,
    );
    if (deleted) {
      await markPlatformReceiptWithdrawn(publication.platform_receipt_id);
    }
    return deleted;
  }

  async function attemptTakedowns(publications) {
    if (!publications.length) return 'COMPLETED';
    let completed = 0;
    let failed = 0;
    const youtubeState = { accessToken: '' };

    for (const publication of publications) {
      if (publication.processing_status === 'withdrawn') {
        completed += 1;
        continue;
      }

      try {
        let deleted = false;
        if (publication.platform === 'r2') {
          deleted = await attemptR2Takedown(publication);
        } else if (publication.platform === 'youtube') {
          deleted = await attemptYoutubeTakedown(
            publication,
            youtubeState,
          );
        }
        if (deleted) completed += 1;
        else failed += 1;
      } catch (_) {
        failed += 1;
      }
    }

    if (failed === 0) return 'COMPLETED';
    if (completed > 0) return 'PARTIAL';
    return 'PENDING';
  }

  async function retryPendingPrimaryReferenceDeletes() {
    if (primaryReferenceProviderName !== 'r2') {
      return { attempted: 0, completed: 0 };
    }
    const jobs = await claimDeleteJobs(pool, {
      provider: 'r2',
      limit: 50,
    });
    let completed = 0;
    for (const job of jobs) {
      try {
        const result = await requireR2ReferenceProvider()
          .deleteReference(job.receipt);
        if (!result?.deleted) {
          await markDeleteRetry(
            pool,
            job.jobId,
            'R2_DELETE_NOT_CONFIRMED',
          );
          continue;
        }
        await markPrimaryReferenceDeleted(pool, job.jobId);
        await pool.query(`
          UPDATE verified_originals_platform_receipts
          SET processing_status='withdrawn',
              visibility='unavailable',
              verified_at=NOW()
          WHERE platform='r2'
            AND platform_post_id=$1
            AND processing_status<>'withdrawn'
        `, [job.objectId]);
        completed += 1;
      } catch (_) {
        try {
          await markDeleteRetry(
            pool,
            job.jobId,
            'R2_DELETE_PROVIDER_UNAVAILABLE',
          );
        } catch (_) {}
      }
    }
    return { attempted: jobs.length, completed };
  }

  async function retryPendingTakedowns() {
    const rows = (await pool.query(`
      SELECT p.hcv_id,p.publication_id,p.platform,p.platform_post_id,
             p.platform_receipt_id,p.reference_role,r.processing_status
      FROM verified_originals_publications p
      JOIN verified_originals_platform_receipts r
        ON r.receipt_id=p.platform_receipt_id
      WHERE p.publication_status='REVOKED'
        AND r.processing_status<>'withdrawn'
      ORDER BY p.revoked_at ASC NULLS LAST
      LIMIT 100
    `)).rows;
    let completed = 0;
    for (const row of rows) {
      const status = await attemptTakedowns([row]);
      if (status === 'COMPLETED') {
        completed += 1;
        try {
          await audit({
            hcvId: row.hcv_id,
            publicationId: row.publication_id,
            eventType: 'PLATFORM_TAKEDOWN_COMPLETED',
            actorType: 'SIGILLUM_PUBLISHER',
            actorSubjectHash: hashString(
              String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
            ),
            metadata: {
              retryWorker: true,
              platform: row.platform,
            },
          });
        } catch (_) {}
      }
    }
    return { attempted: rows.length, completed };
  }

  function startTakedownWorker() {
    if (takedownTimer) return;
    if (!youtubeServiceConfigured() &&
        primaryReferenceProviderName !== 'r2') {
      return;
    }
    const intervalMs = Math.max(
      60_000,
      Number(process.env.SIGILLUM_TAKEDOWN_RETRY_MS || 300_000),
    );
    takedownTimer = setInterval(() => {
      Promise.all([
        retryPendingTakedowns(),
        retryPendingPrimaryReferenceDeletes(),
      ]).catch(error => {
        console.error(
          'SIGILLUM_TAKEDOWN_RETRY_FAILED',
          error?.message || error,
        );
      });
    }, intervalMs);
    if (typeof takedownTimer.unref === 'function') takedownTimer.unref();
  }

  async function withdrawConsent(req, hcvId) {
    const session = await authenticate(req);
    await ownedOriginal(hcvId, session);
    const client = await pool.connect();
    let publications = [];
    let consent;
    let newlyWithdrawn = false;
    try {
      await client.query('BEGIN');
      consent = (await client.query(`
        SELECT * FROM verified_originals_consents
        WHERE hcv_id=$1 AND account_id=$2 AND state='ACTIVE'
        ORDER BY consented_at DESC LIMIT 1 FOR UPDATE
      `, [hcvId, session.account_id])).rows[0];

      if (consent) {
        newlyWithdrawn = true;
        publications = (await client.query(`
          SELECT p.hcv_id,p.publication_id,p.platform,p.platform_post_id,
                 p.platform_receipt_id,p.reference_role,
                 r.processing_status
          FROM verified_originals_publications p
          JOIN verified_originals_platform_receipts r
            ON r.receipt_id=p.platform_receipt_id
          WHERE p.hcv_id=$1 AND p.consent_record_id=$2
            AND p.publication_status='PUBLISHED'
        `, [hcvId, consent.record_id])).rows;
        await client.query(
          "UPDATE verified_originals_consents SET state='WITHDRAWN',withdrawn_at=NOW() WHERE record_id=$1",
          [consent.record_id],
        );
        await client.query(
          "UPDATE verified_originals_publications SET publication_status='REVOKED',revoked_at=NOW() WHERE hcv_id=$1 AND consent_record_id=$2 AND publication_status='PUBLISHED'",
          [hcvId, consent.record_id],
        );
        for (const publication of publications) {
          if (publication.platform === 'r2') {
            await requestDeleteByProviderObject(client, {
              provider: 'r2',
              objectId: publication.platform_post_id,
              hcvId,
            });
          }
          await client.query(`
            UPDATE verified_originals_platform_receipts
            SET processing_status='takedown_pending',verified_at=NOW()
            WHERE receipt_id=$1 AND processing_status<>'withdrawn'
          `, [publication.platform_receipt_id]);
          publication.processing_status = 'takedown_pending';
        }
        await audit({
          hcvId,
          eventType: 'CREATOR_CONSENT_WITHDRAWN',
          actorType: 'CREATOR',
          actorSubjectHash: hashString(session.account_id),
          metadata: {
            platformStatus: 'TAKEDOWN_REQUESTED',
            providers: [...new Set(publications.map(item => item.platform))],
          },
          client,
        });
      } else {
        consent = (await client.query(`
          SELECT * FROM verified_originals_consents
          WHERE hcv_id=$1 AND account_id=$2 AND state='WITHDRAWN'
          ORDER BY withdrawn_at DESC NULLS LAST, consented_at DESC
          LIMIT 1
        `, [hcvId, session.account_id])).rows[0];
        if (!consent) fail('WITHDRAWN_CONSENT_NOT_FOUND', 404);
        publications = (await client.query(`
          SELECT p.hcv_id,p.publication_id,p.platform,p.platform_post_id,
                 p.platform_receipt_id,p.reference_role,
                 r.processing_status
          FROM verified_originals_publications p
          JOIN verified_originals_platform_receipts r
            ON r.receipt_id=p.platform_receipt_id
          WHERE p.hcv_id=$1 AND p.consent_record_id=$2
            AND p.publication_status='REVOKED'
        `, [hcvId, consent.record_id])).rows;
      }
      await client.query('COMMIT');
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw error;
    } finally {
      client.release();
    }

    const takedown = await attemptTakedowns(publications);
    if (takedown === 'COMPLETED' && publications.length) {
      try {
        await audit({
          hcvId,
          eventType: 'PLATFORM_TAKEDOWN_COMPLETED',
          actorType: newlyWithdrawn ? 'CREATOR' : 'SIGILLUM_PUBLISHER',
          actorSubjectHash: hashString(
            newlyWithdrawn
              ? session.account_id
              : String(process.env.SIGILLUM_PUBLISHER_ID || 'SIGILLUM_SERVER_V1'),
          ),
          metadata: { retry: !newlyWithdrawn },
        });
      } catch (_) {}
    }
    return {
      ok: true,
      hcvId,
      consentState: 'WITHDRAWN',
      referenceAvailable: false,
      platformTakedown: takedown,
    };
  }

  async function withdrawAllForAccount(req, accountId) {
    const session = await authenticate(req);
    if (!session?.account_id || session.account_id !== accountId) {
      fail('CREATOR_OWNERSHIP_NOT_VERIFIED', 403);
    }

    const rows = (await pool.query(`
      SELECT DISTINCT hcv_id
      FROM verified_originals_consents
      WHERE account_id=$1
      ORDER BY hcv_id
    `, [accountId])).rows;

    const results = [];
    for (const row of rows) {
      const hcvId = String(row.hcv_id || '');
      if (!HCV_ID.test(hcvId)) continue;
      const result = await withdrawConsent(req, hcvId);
      results.push(result);
      if (result.platformTakedown !== 'COMPLETED') {
        fail(
          'ACCOUNT_DELETE_REFERENCE_CLEANUP_PENDING',
          503,
          'La cancellazione account è sospesa finché la rimozione delle reference tecniche non è completata.',
        );
      }
    }
    return {
      ok: true,
      referenceCount: results.length,
      allReferencesDeleted: true,
    };
  }

  async function handle(req, res, url) {
    const publicLookup = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const view = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/view$/.exec(url.pathname);
    const list = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/publications$/.exec(url.pathname);
    const verifyReference = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/verification-reference$/.exec(url.pathname);
    const readAuthorization = /^\/api\/verified-originals\/(HCV-[A-F0-9]{16})\/read-authorization$/.exec(url.pathname);
    const readReference = /^\/api\/verified-originals\/reference-read\/([A-Za-z0-9_-]{40,256})$/.exec(url.pathname);
    const consentStatusMatch = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const withdraw = /^\/api\/verified-originals\/consents\/(HCV-[A-F0-9]{16})\/withdraw$/.exec(url.pathname);
    const publish = /^\/api\/verified-originals\/publish\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const publishSubtitle = /^\/api\/verified-originals\/publish-subtitle\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);
    const page = /^\/originals\/(HCV-[A-F0-9]{16})$/.exec(url.pathname);

    if (req.method === 'GET' && publicLookup) {
      sendJson(res, 200, await publicAvailability(publicLookup[1]));
      return true;
    }
    if (req.method === 'GET' && verifyReference) {
      sendJson(res, 200, await verificationReference(verifyReference[1]));
      return true;
    }
    if (req.method === 'POST' && readAuthorization) {
      sendJson(
        res,
        201,
        await createR2ReadAuthorization(req, readAuthorization[1]),
      );
      return true;
    }
    if (req.method === 'GET' && readReference) {
      await streamAuthorizedR2Reference(req, res, readReference[1]);
      return true;
    }
    if (req.method === 'GET' && view) {
      const session = await authenticate(req);
      const account = await accountEnvelope(session.account_id, session.device_key_fingerprint);
      if (account.subscriptionStatus !== 'active') fail('SUBSCRIPTION_REQUIRED', 402);
      const reference = await activeReference(view[1]);
      if (!reference) fail('REFERENCE_NOT_AVAILABLE', 404);
      const safeReference = referenceViewEnvelope(reference);
      if (!safeReference) fail('REFERENCE_NOT_AVAILABLE', 404);
      sendJson(res, 200, {
        hcvId: view[1],
        availability: 'REFERENCE_AVAILABLE',
        access: 'ENTITLED',
        ...safeReference,
      });
      return true;
    }
    if (req.method === 'GET' && list) {
      sendJson(res, 200, { hcvId: list[1], publications: await publicHistory(list[1]) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/verified-originals/consents') {
      sendJson(res, 201, await createConsent(req));
      return true;
    }
    if (req.method === 'GET' && consentStatusMatch) {
      sendJson(res, 200, await consentStatus(req, consentStatusMatch[1]));
      return true;
    }
    if (req.method === 'POST' && withdraw) {
      sendJson(res, 200, await withdrawConsent(req, withdraw[1]));
      return true;
    }
    if (req.method === 'POST' && publish) {
      sendJson(res, 201, await publishOriginal(req, publish[1], url));
      return true;
    }
    if (req.method === 'POST' && publishSubtitle) {
      sendJson(
        res,
        201,
        await publishSubtitleDerivative(req, publishSubtitle[1], url),
      );
      return true;
    }
    if (req.method === 'GET' && page) {
      const availability = await publicAvailability(page[1]);
      const available = availability.availability === 'REFERENCE_AVAILABLE';
      const lang = ['it','en','es','ru'].includes(String(url.searchParams.get('lang') || '').toLowerCase())
        ? String(url.searchParams.get('lang')).toLowerCase()
        : 'en';
      const copy = {
        it: {
          title: 'SIGILLUM Originali certificati',
          available: 'ORIGINALE CERTIFICATO DISPONIBILE',
          missing: 'RIFERIMENTO NON DISPONIBILE',
          access: 'La verifica è gratuita. L’accesso al riferimento tecnico tramite SIGILLUM richiede un abbonamento attivo. Eventuali copie social sono distribuzioni opzionali e non costituiscono il riferimento tecnico.',
          absent: 'Nessun originale certificato attivo è disponibile.',
          warning: 'La presenza di un HCV-ID non prova che un file social esterno sia identico all’originale.',
        },
        en: {
          title: 'SIGILLUM Certified Originals',
          available: 'CERTIFIED ORIGINAL AVAILABLE',
          missing: 'REFERENCE NOT AVAILABLE',
          access: 'Verification is free. Accessing the technical reference through SIGILLUM requires an active subscription. Any social copies are optional distributions and are not the technical reference.',
          absent: 'No active certified original is available.',
          warning: 'The presence of an HCV-ID does not prove that an external social file is identical to the original.',
        },
        es: {
          title: 'Originales certificados SIGILLUM',
          available: 'ORIGINAL CERTIFICADO DISPONIBLE',
          missing: 'REFERENCIA NO DISPONIBLE',
          access: 'La verificación es gratuita. El acceso a la referencia técnica mediante SIGILLUM requiere una suscripción activa. Las copias sociales son distribuciones opcionales y no constituyen la referencia técnica.',
          absent: 'No hay ningún original certificado activo disponible.',
          warning: 'La presencia de un HCV-ID no demuestra que un archivo externo de una red social sea idéntico al original.',
        },
        ru: {
          title: 'Сертифицированные оригиналы SIGILLUM',
          available: 'СЕРТИФИЦИРОВАННЫЙ ОРИГИНАЛ ДОСТУПЕН',
          missing: 'ЭТАЛОН НЕДОСТУПЕН',
          access: 'Проверка бесплатна. Для доступа к техническому эталону через SIGILLUM требуется активная подписка. Копии в социальных сетях являются необязательными и не заменяют технический эталон.',
          absent: 'Активный сертифицированный оригинал отсутствует.',
          warning: 'Наличие HCV-ID не доказывает, что внешний файл из социальной сети идентичен оригиналу.',
        },
      }[lang];
      const html = '<!doctype html><html lang="' + lang + '"><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + copy.title + '</title>' +
        '<main style="max-width:720px;margin:40px auto;font:17px/1.5 sans-serif">' +
        '<h1>' + (available ? copy.available : copy.missing) + '</h1>' +
        '<p>HCV-ID: ' + page[1] + '</p>' +
        (available ? '<p>' + copy.access + '</p>' : '<p>' + copy.absent + '</p>') +
        '<p>' + copy.warning + '</p>' +
        '</main></html>';
      sendHtml(res, available ? 200 : 404, html);
      return true;
    }
    return false;
  }

  return {
    initSchema,
    handle,
    publicAvailability,
    verificationReference,
    activeReference,
    activeSubtitleReference,
    withdrawAllForAccount,
    verifyDerivationManifest: args =>
      verifyDerivationManifest({ ...args, verifyCertificateRaw }),
    verifySubtitleDerivationManifest: args =>
      verifySubtitleDerivationManifest({ ...args, verifyCertificateRaw }),
  };
}

module.exports = {
  CONSENT_VERSION,
  DERIVATION_OPERATION,
  PHOTO_DERIVATION_OPERATION,
  SUBTITLE_DERIVATION_OPERATION,
  SUBTITLE_DERIVATION_SCHEMA,
  ORIGINAL_REFERENCE_ROLE,
  DERIVED_REFERENCE_ROLE,
  DERIVATION_SCHEMA,
  YOUTUBE_SCOPE,
  canonicalYoutubeReference,
  createVerifiedOriginalsProduction,
  verifyDerivationManifest,
  verifySubtitleDerivationManifest,
  referenceVisualFrameV3,
  referenceVisualFingerprintV3FromRaw,
  validReferenceVisualFingerprintV3,
  buildReferenceVisualFingerprintV3,
  compareReferenceVisualFingerprintsV3,
};