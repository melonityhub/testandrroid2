'use strict';
/**
 * Preload – the ONLY bridge between the sandboxed-ish renderer frames and the
 * main process. It runs in every frame (nodeIntegrationInSubFrames: true) so
 * the shell, the player and the vocabulary panel all get `window.pvBridge`.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const shared = require('../main/shared');

const ALLOWED = new Set([
  'pv:app-info', 'pv:open-dialog', 'pv:open-directory', 'pv:media-url', 'pv:file-info',
  'pv:read-bytes', 'pv:scan-subtitles', 'pv:list-videos', 'pv:store-load', 'pv:store-save',
  'pv:store-path', 'pv:net-fetch', 'pv:open-external', 'pv:show-in-folder',
  'pv:window-action', 'pv:set-progress', 'pv:is-fullscreen',
]);
const EVENTS = new Set(['pv:menu-action', 'pv:open-files', 'pv:fullscreen-changed']);

const listeners = new Map();

const api = {
  invoke(channel, ...args) {
    if (!ALLOWED.has(channel)) return Promise.reject(new Error(`pvBridge: channel not allowed: ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    if (channel === 'pv:net-abort') { ipcRenderer.send(channel, ...args); return true; }
    return false;
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) return () => {};
    const wrapped = (_e, payload) => { try { cb(payload); } catch (err) { console.error('[pvBridge] listener error', err); } };
    ipcRenderer.on(channel, wrapped);
    if (!listeners.has(channel)) listeners.set(channel, []);
    listeners.get(channel).push(wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      const arr = listeners.get(channel) || [];
      const i = arr.indexOf(wrapped);
      if (i >= 0) arr.splice(i, 1);
    };
  },
  /** Electron >= 32 removed File.path – this is the supported replacement. */
  getPathForFile(file) {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  mediaUrlFor: (p) => shared.mediaUrlFor(p),
  localIdFor: (p) => shared.localIdFor(p),
  isVideoFile: (p) => shared.isVideoFile(p),
  isSubtitleFile: (p) => shared.isSubtitleFile(p),
  isAudioFile: (p) => shared.isAudioFile(p),
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
};

contextBridge.exposeInMainWorld('pvBridge', api);
