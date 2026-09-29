'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ffmpegPath = require('ffmpeg-static');

const {
  buildReferenceVisualFingerprintV3,
  compareReferenceVisualFingerprintsV3,
} = require('./verified_originals_production');

assert(ffmpegPath, 'ffmpeg-static is required');

function run(args) {
  execFileSync(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
  });
}

async function fingerprint(filePath, mediaType, workDir) {
  return buildReferenceVisualFingerprintV3({
    ffmpegPath,
    filePath,
    mediaType,
    workDir,
  });
}

function assertModified(result, label) {
  assert.equal(
    result.verdict,
    'modified',
    label + ' must be classified as modified',
  );
  assert(
    result.modifiedFrames >= 1,
    label + ' must contain at least one modified frame',
  );
}

(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sigillum-reference-v3-real-media-'),
  );

  try {
    const videoOriginal = path.join(root, 'video-original.mp4');
    const videoOfficial = path.join(root, 'video-official.mp4');
    const videoSocial = path.join(root, 'video-social.mp4');
    const videoUfo = path.join(root, 'video-social-ufo.mp4');
    const videoHue = path.join(root, 'video-social-hue.mp4');
    const videoBrightness = path.join(root, 'video-social-brightness.mp4');
    const videoCrop = path.join(root, 'video-social-crop.mp4');

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x4488CC:s=640x360:r=30:d=4',
      '-vf',
      'drawbox=x=60:y=60:w=120:h=80:color=red:t=fill,' +
        'drawbox=x=430:y=250:w=100:h=50:color=green:t=fill',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '12',
      '-pix_fmt', 'yuv420p', '-an',
      videoOriginal,
    ]);

    // Same non-editorial transform used by SIGILLUM for a video reference.
    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoOriginal,
      '-map', '0:v:0', '-map', '0:a?',
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      videoOfficial,
    ]);

    // Social-like downscale + stronger H.264 recompression.
    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoOfficial,
      '-vf', 'scale=480:-2',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoSocial,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoSocial,
      '-vf',
      "drawbox=x=240:y=140:w=28:h=10:color=black:t=fill:enable='between(t,1,3)'",
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoUfo,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoSocial,
      '-vf', 'hue=h=45',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoHue,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoSocial,
      '-vf', 'eq=brightness=0.10',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoBrightness,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoSocial,
      '-vf', 'crop=460:260:10:5,scale=480:270',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoCrop,
    ]);

    const videoExpected = await fingerprint(videoOfficial, 'video', root);
    const videoCompressed = await fingerprint(videoSocial, 'video', root);
    const videoModified = await fingerprint(videoUfo, 'video', root);
    const videoHueFingerprint = await fingerprint(videoHue, 'video', root);
    const videoBrightnessFingerprint =
      await fingerprint(videoBrightness, 'video', root);
    const videoCropFingerprint = await fingerprint(videoCrop, 'video', root);

    const videoCompressedResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoCompressed,
    );
    const videoModifiedResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoModified,
    );
    const videoHueResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoHueFingerprint,
    );
    const videoBrightnessResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoBrightnessFingerprint,
    );
    const videoCropResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoCropFingerprint,
    );

    assert.equal(videoCompressedResult.verdict, 'conforming');
    assert.equal(videoCompressedResult.modifiedFrames, 0);
    assertModified(videoModifiedResult, 'video small UFO');
    assertModified(videoHueResult, 'video hue change');
    assertModified(videoBrightnessResult, 'video brightness change');
    assertModified(videoCropResult, 'video crop');

    const photoOriginal = path.join(root, 'photo-original.jpg');
    const photoOfficial = path.join(root, 'photo-official.mp4');
    const photoSocial = path.join(root, 'photo-social.jpg');
    const photoUfo = path.join(root, 'photo-social-ufo.jpg');
    const photoHue = path.join(root, 'photo-social-hue.jpg');
    const photoBrightness = path.join(root, 'photo-social-brightness.jpg');
    const photoCrop = path.join(root, 'photo-social-crop.jpg');

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0x4488CC:s=640x360:d=1',
      '-vf',
      'drawbox=x=60:y=60:w=120:h=80:color=red:t=fill,' +
        'drawbox=x=430:y=250:w=100:h=50:color=green:t=fill',
      '-frames:v', '1', '-q:v', '2',
      photoOriginal,
    ]);

    // Exact SIGILLUM photo -> official 5-second video reference transform.
    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-loop', '1', '-i', photoOriginal,
      '-t', '5', '-r', '30',
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,' +
        'pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p',
      '-map_metadata', '-1', '-map_chapters', '-1',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
      '-an', '-movflags', '+faststart',
      photoOfficial,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', photoOriginal,
      '-vf', 'scale=480:-2',
      '-frames:v', '1', '-q:v', '18',
      photoSocial,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', photoSocial,
      '-vf', 'drawbox=x=240:y=140:w=28:h=10:color=black:t=fill',
      '-frames:v', '1', '-q:v', '18',
      photoUfo,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', photoSocial,
      '-vf', 'hue=h=45',
      '-frames:v', '1', '-q:v', '18',
      photoHue,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', photoSocial,
      '-vf', 'eq=brightness=0.10',
      '-frames:v', '1', '-q:v', '18',
      photoBrightness,
    ]);

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', photoSocial,
      '-vf', 'crop=460:260:10:5,scale=480:270',
      '-frames:v', '1', '-q:v', '18',
      photoCrop,
    ]);

    const photoExpected = await fingerprint(photoOfficial, 'photo', root);
    const photoCompressed = await fingerprint(photoSocial, 'photo', root);
    const photoModified = await fingerprint(photoUfo, 'photo', root);
    const photoHueFingerprint = await fingerprint(photoHue, 'photo', root);
    const photoBrightnessFingerprint =
      await fingerprint(photoBrightness, 'photo', root);
    const photoCropFingerprint = await fingerprint(photoCrop, 'photo', root);

    const photoCompressedResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoCompressed,
    );
    const photoModifiedResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoModified,
    );
    const photoHueResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoHueFingerprint,
    );
    const photoBrightnessResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoBrightnessFingerprint,
    );
    const photoCropResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoCropFingerprint,
    );

    assert.equal(photoCompressedResult.verdict, 'conforming');
    assert.equal(photoCompressedResult.modifiedFrames, 0);
    assertModified(photoModifiedResult, 'photo small UFO');
    assertModified(photoHueResult, 'photo hue change');
    assertModified(photoBrightnessResult, 'photo brightness change');
    assertModified(photoCropResult, 'photo crop');

    console.log(JSON.stringify({
      ok: true,
      videoCompressed: videoCompressedResult,
      videoSmallUfo: videoModifiedResult,
      videoHue: videoHueResult,
      videoBrightness: videoBrightnessResult,
      videoCrop: videoCropResult,
      photoCompressed: photoCompressedResult,
      photoSmallUfo: photoModifiedResult,
      photoHue: photoHueResult,
      photoBrightness: photoBrightnessResult,
      photoCrop: photoCropResult,
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
