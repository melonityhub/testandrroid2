#!/usr/bin/env node
/**
 * make-sample.mjs – (re)creates the bundled demo clip.
 *   samples/sample-video.srt  – always written
 *   samples/sample-video.mp4  – written when ffmpeg is available
 * Handy for verifying an installation without hunting for a movie file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'samples');
fs.mkdirSync(DIR, { recursive: true });

const SRT = `1
00:00:01,000 --> 00:00:05,200
Welcome to ProudVocab Desktop, a tiny experiment in learning vocabulary from movies.

2
00:00:05,600 --> 00:00:09,800
Pick any local video file, drop an SRT beside it, and every word becomes clickable.

3
00:00:10,200 --> 00:00:14,600
The engine will highlight unusual words and tell you roughly how advanced they are.

4
00:00:15,000 --> 00:00:19,400
Hover over a word to see a translation, or save it for a spaced repetition review.

5
00:00:19,800 --> 00:00:24,200
Sometimes characters give up on their plans, and sometimes they carry on regardless.

6
00:00:24,600 --> 00:00:29,000
It was raining cats and dogs, so the meticulous investigation had to be postponed.

7
00:00:29,400 --> 00:00:34,000
Nevertheless, the reluctant witness eventually revealed a crucial, ambiguous detail.

8
00:00:34,400 --> 00:00:39,000
And that is how you turn an ordinary evening into a sustainable learning habit.
`;

fs.writeFileSync(path.join(DIR, 'sample-video.srt'), SRT, 'utf8');
console.log('✓ samples/sample-video.srt');

const mp4 = path.join(DIR, 'sample-video.mp4');
const ff = spawnSync(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', ['-version'], { stdio: 'ignore' });
if (ff.error || ff.status !== 0) {
  console.log('! ffmpeg not found – skipped sample-video.mp4');
  console.log('  Install ffmpeg, or just open one of your own videos in the app.');
  process.exit(0);
}

const args = [
  '-hide_banner', '-loglevel', 'error', '-y',
  '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=25:duration=40',
  '-f', 'lavfi', '-i', 'sine=frequency=320:sample_rate=44100:duration=40',
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart',
  mp4,
];
const r = spawnSync(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', args, { stdio: 'inherit' });
if (r.status === 0) console.log('✓ samples/sample-video.mp4 (' + Math.round(fs.statSync(mp4).size / 1024) + ' KB)');
else { console.error('! ffmpeg failed with code ' + r.status); process.exit(1); }
