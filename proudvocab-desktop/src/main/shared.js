'use strict';
/**
 * Small helpers shared by the main process and (through the preload bridge)
 * by the renderer.
 */
const path = require('node:path');

const APP_SCHEME = 'app';
const MEDIA_SCHEME = 'pv-media';
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  /* media */
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.flv': 'video/x-flv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
  '.vob': 'video/dvd',
  '.m3u8': 'application/vnd.apple.mpegurl',
  /* audio (used for dictionary pronunciations / local audio files) */
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.ogv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.3gp', '.vob']);
const SUBTITLE_EXT = new Set(['.srt', '.vtt', '.ass', '.ssa', '.sub']);
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.flac']);

function extOf(p) {
  return path.extname(String(p || '')).toLowerCase();
}
function isVideoFile(p) {
  return VIDEO_EXT.has(extOf(p));
}
function isSubtitleFile(p) {
  return SUBTITLE_EXT.has(extOf(p));
}
function isAudioFile(p) {
  return AUDIO_EXT.has(extOf(p));
}

/**
 * pv-media://v/<base64url(absolute path)>
 * base64url keeps Windows drive letters, spaces, Persian/Arabic file names and
 * backslashes out of the URL parser's way.
 */
function mediaUrlFor(absPath) {
  const b64 = Buffer.from(String(absPath), 'utf8').toString('base64url');
  return `${MEDIA_SCHEME}://v/${b64}`;
}

/** `pv-local://<base64url(path)>` – the stable, opaque identity of a video.
 *  It is what gets written into saved words (source.url) so that clicking a
 *  word later can re-open exactly this file and jump to the timestamp. */
function localIdFor(absPath) {
  return `pv-local://${Buffer.from(String(absPath), 'utf8').toString('base64url')}`;
}

module.exports = {
  APP_SCHEME, MEDIA_SCHEME, APP_ORIGIN, MIME,
  VIDEO_EXT, SUBTITLE_EXT, AUDIO_EXT,
  isVideoFile, isSubtitleFile, isAudioFile, mediaUrlFor, localIdFor,
};
