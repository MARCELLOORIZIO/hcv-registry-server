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

(async () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'sigillum-reference-v3-real-media-'),
  );

  try {
    const videoOriginal = path.join(root, 'video-original.mp4');
    const videoOfficial = path.join(root, 'video-official.mp4');
    const videoSocial = path.join(root, 'video-social.mp4');
    const videoUfo = path.join(root, 'video-social-ufo.mp4');

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0xA0A0A0:s=640x360:r=30:d=4',
      '-vf',
      'drawbox=x=60:y=60:w=120:h=80:color=white:t=fill,' +
        'drawbox=x=430:y=250:w=100:h=50:color=0x707070:t=fill',
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

    // Same social copy, but with a small local synthetic object for 2 seconds.
    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-i', videoSocial,
      '-vf',
      "drawbox=x=240:y=140:w=28:h=10:color=black:t=fill:enable='between(t,1,3)'",
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '35',
      '-pix_fmt', 'yuv420p', '-an',
      videoUfo,
    ]);

    const videoExpected = await fingerprint(videoOfficial, 'video', root);
    const videoCompressed = await fingerprint(videoSocial, 'video', root);
    const videoModified = await fingerprint(videoUfo, 'video', root);

    const videoCompressedResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoCompressed,
    );
    const videoModifiedResult = compareReferenceVisualFingerprintsV3(
      videoExpected,
      videoModified,
    );

    assert.equal(videoCompressedResult.verdict, 'conforming');
    assert.equal(videoCompressedResult.modifiedFrames, 0);
    assert.equal(videoModifiedResult.verdict, 'modified');
    assert(videoModifiedResult.modifiedFrames >= 1);

    const photoOriginal = path.join(root, 'photo-original.jpg');
    const photoOfficial = path.join(root, 'photo-official.mp4');
    const photoSocial = path.join(root, 'photo-social.jpg');
    const photoUfo = path.join(root, 'photo-social-ufo.jpg');

    run([
      '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
      '-f', 'lavfi',
      '-i', 'color=c=0xA0A0A0:s=640x360:d=1',
      '-vf',
      'drawbox=x=60:y=60:w=120:h=80:color=white:t=fill,' +
        'drawbox=x=430:y=250:w=100:h=50:color=0x707070:t=fill',
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

    const photoExpected = await fingerprint(photoOfficial, 'photo', root);
    const photoCompressed = await fingerprint(photoSocial, 'photo', root);
    const photoModified = await fingerprint(photoUfo, 'photo', root);

    const photoCompressedResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoCompressed,
    );
    const photoModifiedResult = compareReferenceVisualFingerprintsV3(
      photoExpected,
      photoModified,
    );

    assert.equal(photoCompressedResult.verdict, 'conforming');
    assert.equal(photoCompressedResult.modifiedFrames, 0);
    assert.equal(photoModifiedResult.verdict, 'modified');
    assert.equal(photoModifiedResult.modifiedFrames, 1);

    console.log(JSON.stringify({
      ok: true,
      videoCompressed: videoCompressedResult,
      videoSmallUfo: videoModifiedResult,
      photoCompressed: photoCompressedResult,
      photoSmallUfo: photoModifiedResult,
    }, null, 2));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
