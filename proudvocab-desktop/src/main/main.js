'use strict';
/**
 * ProudVocab Desktop – Electron main process
 * ---------------------------------------------------------------------------
 * Responsibilities
 *   • register the two custom protocols
 *       app://bundle/...   → the renderer bundle (secure, same-origin frames)
 *       pv-media://v/<b64> → any local file, with HTTP Range support so that
 *                            <video> can seek inside big movies
 *   • create the window + application menu
 *   • be the *only* place that talks to the OS (dialogs, shell, files) and to
 *     the internet (the renderer's fetch() is proxied through here so that
 *     Google Translate / dictionaryapi work without CORS problems)
 */
const {
  app, BrowserWindow, ipcMain, dialog, shell, Menu, protocol, net, session,
} = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
const { MIME, APP_SCHEME, MEDIA_SCHEME, mediaUrlFor, isVideoFile, isSubtitleFile } = require('./shared');

const DEV = !app.isPackaged || process.argv.includes('--dev');
const SMOKE = process.argv.includes('--smoke');
const RENDERER_ROOT = path.join(app.getAppPath(), 'src', 'renderer');
const DATA_DIR = () => path.join(app.getPath('userData'), 'proudvocab-data');
const STORE_FILE = () => path.join(DATA_DIR(), 'store.json');

/* ------------------------------------------------------------------ schemes */
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
      stream: true, codeCache: true,
    },
  },
  {
    scheme: MEDIA_SCHEME,
    privileges: {
      standard: true, secure: true, supportFetchAPI: true, stream: true,
      bypassCSP: true, corsEnabled: true,
    },
  },
]);

/* single instance ---------------------------------------------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  boot();
}

function boot() {
  /* keep the self-test from touching the real user profile */
  if (SMOKE) {
    /* packaged builds are read-only (asar) – keep the scratch profile in tmp */
    const root = app.isPackaged ? path.join(os.tmpdir(), 'proudvocab-smoke') : path.join(app.getAppPath(), 'smoke-out');
    const smokeProfile = path.join(root, 'userdata');
    try { fs.rmSync(smokeProfile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    try { fs.mkdirSync(root, { recursive: true }); } catch (e) { /* ignore */ }
    try { app.setPath('userData', smokeProfile); } catch (e) { /* ignore */ }
  }
  /* Chromium needs these for reliable local playback + programmatic play() */
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  app.commandLine.appendSwitch('enable-features', 'MediaRouter,CastMediaRouteProvider');
  if (process.env.PV_NO_SANDBOX === '1') app.commandLine.appendSwitch('no-sandbox');
  if (process.platform === 'win32') app.setAppUserModelId('com.proudvocab.desktop');

  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const files = argv.filter((a) => !a.startsWith('-') && (isVideoFile(a) || isSubtitleFile(a)));
    if (files.length) send('pv:open-files', { filePaths: files });
  });

  app.whenReady().then(async () => {
    registerProtocolHandlers();
    registerIpc();
    buildMenu();

    const initialFiles = process.argv.filter((a) => !a.startsWith('-') && (isVideoFile(a) || isSubtitleFile(a)));

    if (SMOKE) {
      await require('./smoke').run({ app, BrowserWindow, createMainWindow, initialFiles, RENDERER_ROOT });
      return;
    }

    createMainWindow();
    if (initialFiles.length) {
      mainWindow.webContents.once('did-finish-load', () => send('pv:open-files', { filePaths: initialFiles }));
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/* ------------------------------------------------------------------ window */
let mainWindow = null;
const windowState = loadWindowState();

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: windowState.width || 1440,
    height: windowState.height || 900,
    x: windowState.x,
    y: windowState.y,
    minWidth: 940,
    minHeight: 560,
    backgroundColor: '#070a12',
    title: 'ProudVocab Desktop',
    icon: path.join(RENDERER_ROOT, 'ext', 'icons', process.platform === 'win32' ? 'icon128.png' : 'icon128.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      nodeIntegrationInSubFrames: true, // the shim needs pvBridge inside every iframe
      spellcheck: false,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`${APP_SCHEME}://bundle/index.html`);

  if (DEV && process.env.PV_DEVTOOLS === '1') mainWindow.webContents.openDevTools({ mode: 'detach' });

  /* keep the shell in control of navigation / popups */
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    handleExternalUrl(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${APP_SCHEME}://bundle/`)) e.preventDefault();
  });
  mainWindow.webContents.on('will-frame-navigate', (e) => {
    const url = e.url || '';
    if (url.startsWith(`${APP_SCHEME}://bundle/`) || url === 'about:blank') return;
    if (url.startsWith(`${MEDIA_SCHEME}://`)) return;
    e.preventDefault();
    handleExternalUrl(url);
  });

  const save = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const b = mainWindow.getBounds();
    if (!mainWindow.isMaximized()) {
      fs.mkdirSync(DATA_DIR(), { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR(), 'window.json'), JSON.stringify(b));
    }
  };
  mainWindow.on('enter-full-screen', () => send('pv:fullscreen-changed', { on: true }));
  mainWindow.on('leave-full-screen', () => send('pv:fullscreen-changed', { on: false }));
  mainWindow.on('maximize', () => send('pv:fullscreen-changed', { on: mainWindow.isFullScreen() }));
  mainWindow.on('resize', debounce(save, 400));
  mainWindow.on('move', debounce(save, 400));
  mainWindow.on('closed', () => { mainWindow = null; });
  return mainWindow;
}

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR(), 'window.json'), 'utf8')); } catch { return {}; }
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/* ---------------------------------------------------------------- protocols */
function registerProtocolHandlers() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p.endsWith('/')) p += 'index.html';
      const filePath = path.normalize(path.join(RENDERER_ROOT, p));
      if (!filePath.startsWith(RENDERER_ROOT)) return text('Forbidden', 403);
      if (!fs.existsSync(filePath)) return text(`Not found: ${p}`, 404);
      const body = await fs.promises.readFile(filePath);
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' },
      });
    } catch (e) {
      return text(String(e && e.message || e), 500);
    }
  });

  /* Local media with proper HTTP range support (required for seeking). */
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let filePath = '';
    try { filePath = pathFromMediaUrl(request.url); } catch { return text('bad url', 400); }
    let stat;
    try { stat = fs.statSync(filePath); } catch { return text('not found', 404); }
    if (!stat.isFile()) return text('not a file', 404);

    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const total = stat.size;
    const range = request.headers.get('range');
    const headers = new Headers({
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
      if (!m || (!m[1] && !m[2])) { start = 0; end = total - 1; }
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= total) end = total - 1;
      if (start > end) {
        headers.set('Content-Range', `bytes */${total}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
      headers.set('Content-Length', String(end - start + 1));
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => stream.destroy());
      return new Response(Readable.toWeb(stream), { status: 206, headers });
    }

    headers.set('Content-Length', String(total));
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => stream.destroy());
    return new Response(Readable.toWeb(stream), { status: 200, headers });
  });
}

function pathFromMediaUrl(url) {
  const u = new URL(url);
  // pv-media://v/<base64url(path)> – the payload lives in the *path* because a
  // standard-scheme host would be lower-cased by the URL parser.
  let b64 = decodeURIComponent(u.pathname || '').replace(/^\/+/, '');
  if (!b64 && u.host && u.host !== 'v') b64 = u.host;
  if (!b64) throw new Error('empty path');
  const buf = Buffer.from(b64, 'base64url');
  const p = buf.toString('utf8');
  if (!p || /\0/.test(p)) throw new Error('bad path');
  if (process.env.PV_DEBUG_MEDIA === '1') console.log('[pv-media]', p);
  return p;
}
function text(body, status = 200) {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/* -------------------------------------------------------------------- ipc */
function registerIpc() {
  ipcMain.handle('pv:app-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    packaged: app.isPackaged,
    locale: app.getLocale(),
  }));

  ipcMain.handle('pv:open-dialog', async (_e, opts) => {
    const kind = opts && opts.kind === 'subtitle' ? 'subtitle' : 'video';
    const filters = kind === 'subtitle'
      ? [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub'] }, { name: 'All files', extensions: ['*'] }]
      : [{ name: 'Video', extensions: ['mp4', 'mkv', 'webm', 'mov', 'm4v', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'm2ts', '3gp', 'ogv'] }, { name: 'All files', extensions: ['*'] }];
    const res = await dialog.showOpenDialog(mainWindow, {
      title: kind === 'subtitle' ? 'Select subtitle file (SRT / VTT)' : 'Select video file',
      buttonLabel: kind === 'subtitle' ? 'Select subtitles' : 'Open video',
      defaultPath: opts && opts.defaultPath ? opts.defaultPath : app.getPath('videos'),
      properties: ['openFile'],
      filters,
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: res.filePaths, mediaUrl: mediaUrlFor(res.filePaths[0]) };
  });

  ipcMain.handle('pv:open-directory', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Select a folder of videos',
      defaultPath: app.getPath('videos'),
      properties: ['openDirectory'],
    });
    if (res.canceled || !res.filePaths.length) return { canceled: true, filePaths: [] };
    return { canceled: false, filePaths: res.filePaths };
  });

  ipcMain.handle('pv:media-url', (_e, p) => (typeof p === 'string' && p ? mediaUrlFor(p) : null));

  ipcMain.handle('pv:file-info', async (_e, p) => {
    try {
      const st = fs.statSync(p);
      return {
        ok: true, name: path.basename(p), dir: path.dirname(p), ext: path.extname(p).toLowerCase(),
        size: st.size, mtime: st.mtimeMs, isVideo: isVideoFile(p), isSubtitle: isSubtitleFile(p),
      };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  ipcMain.handle('pv:read-bytes', async (_e, p, maxBytes = 64 * 1024 * 1024) => {
    try {
      const st = fs.statSync(p);
      if (st.size > maxBytes) return { ok: false, error: 'file-too-big', size: st.size };
      const buf = await fs.promises.readFile(p);
      return { ok: true, base64: buf.toString('base64'), size: st.size, name: path.basename(p) };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });

  /** All .srt/.vtt/.ass files that live next to a video (for auto-detection). */
  ipcMain.handle('pv:scan-subtitles', async (_e, videoPath) => {
    try {
      const dir = path.dirname(videoPath);
      const base = path.basename(videoPath, path.extname(videoPath));
      const out = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!isSubtitleFile(full)) continue;
        let st; try { st = fs.statSync(full); } catch { continue; }
        const stem = path.basename(name, path.extname(name));
        out.push({
          name, path: full, size: st.size,
          exact: stem.toLowerCase() === base.toLowerCase(),
          related: stem.toLowerCase().startsWith(base.toLowerCase().slice(0, 8)),
        });
      }
      out.sort((a, b) => (b.exact - a.exact) || (b.related - a.related) || a.name.localeCompare(b.name));
      return { ok: true, files: out.slice(0, 60) };
    } catch (e) { return { ok: false, error: String(e && e.message || e), files: [] }; }
  });

  /** Folder browser – lets the user build a playlist from a directory. */
  ipcMain.handle('pv:list-videos', async (_e, dir) => {
    try {
      const out = [];
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (!isVideoFile(full)) continue;
        let st; try { st = fs.statSync(full); } catch { continue; }
        if (!st.isFile()) continue;
        out.push({ name, path: full, size: st.size, mtime: st.mtimeMs });
      }
      out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      return { ok: true, files: out };
    } catch (e) { return { ok: false, error: String(e && e.message || e), files: [] }; }
  });

  /* --- persisted key/value store (chrome.storage.local + .sync) --------- */
  ipcMain.handle('pv:store-load', async () => {
    try {
      const raw = await fs.promises.readFile(STORE_FILE(), 'utf8');
      const data = JSON.parse(raw);
      return { ok: true, data: { local: data.local || {}, sync: data.sync || {}, meta: data.meta || {} } };
    } catch { return { ok: false, data: { local: {}, sync: {}, meta: {} } }; }
  });
  ipcMain.handle('pv:store-save', async (_e, data) => {
    try {
      fs.mkdirSync(DATA_DIR(), { recursive: true });
      const tmp = STORE_FILE() + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify({ local: data.local || {}, sync: data.sync || {}, meta: { ...(data.meta || {}), savedAt: Date.now() } }, null, 0));
      await fs.promises.rename(tmp, STORE_FILE());
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
  });
  ipcMain.handle('pv:store-path', () => STORE_FILE());

  /* --- network proxy (beats CORS, keeps keys/hosts in one place) -------- */
  const inflight = new Map();
  ipcMain.handle('pv:net-fetch', async (_e, req) => {
    const id = req.id || Math.random().toString(36).slice(2);
    const ctrl = new AbortController();
    inflight.set(id, ctrl);
    const timer = setTimeout(() => ctrl.abort(), Math.min(Math.max(req.timeoutMs || 15000, 1000), 120000));
    try {
      const init = {
        method: req.method || 'GET',
        headers: req.headers || {},
        signal: ctrl.signal,
        redirect: 'follow',
      };
      if (req.body != null && init.method !== 'GET' && init.method !== 'HEAD') init.body = req.body;
      const res = await net.fetch(req.url, init);
      const buf = Buffer.from(await res.arrayBuffer());
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      return { ok: true, status: res.status, statusText: res.statusText, headers, base64: buf.toString('base64') };
    } catch (e) {
      const msg = String(e && e.message || e);
      return { ok: false, status: 0, error: ctrl.signal.aborted ? 'aborted' : msg };
    } finally {
      clearTimeout(timer);
      inflight.delete(id);
    }
  });
  ipcMain.on('pv:net-abort', (_e, id) => {
    const c = inflight.get(id);
    if (c) c.abort();
    inflight.delete(id);
  });

  /* --- shell ------------------------------------------------------------ */
  ipcMain.handle('pv:open-external', (_e, url) => handleExternalUrl(url));
  ipcMain.handle('pv:show-in-folder', (_e, p) => { try { shell.showItemInFolder(p); return true; } catch { return false; } });
  ipcMain.handle('pv:window-action', (_e, action, arg) => {
    if (!mainWindow) return false;
    switch (action) {
      case 'fullscreen': mainWindow.setFullScreen(!mainWindow.isFullScreen()); break;
      case 'minimize': mainWindow.minimize(); break;
      case 'maximize': mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); break;
      case 'close': mainWindow.close(); break;
      case 'always-on-top': mainWindow.setAlwaysOnTop(!!arg); break;
      case 'devtools': mainWindow.webContents.toggleDevTools(); break;
      default: return false;
    }
    return true;
  });
  ipcMain.handle('pv:set-progress', (_e, v) => {
    if (!mainWindow) return false;
    try { mainWindow.setProgressBar(typeof v === 'number' && v >= 0 ? Math.min(1, v) : -1); } catch { /* linux w/o unity */ }
    return true;
  });
  ipcMain.handle('pv:is-fullscreen', () => !!(mainWindow && mainWindow.isFullScreen()));
}

function handleExternalUrl(url) {
  if (typeof url !== 'string') return false;
  if (/^(https?:|mailto:)/i.test(url)) { shell.openExternal(url).catch(() => {}); return true; }
  return false;
}

/* ------------------------------------------------------------------- menu */
function buildMenu() {
  const act = (action, arg) => () => send('pv:menu-action', { action, arg });
  const template = [
    {
      label: 'File / فایل',
      submenu: [
        { label: 'Open video…  (Ctrl+O)', accelerator: 'CmdOrCtrl+O', click: act('open-video') },
        { label: 'Open subtitle (SRT)…  (Ctrl+Shift+O)', accelerator: 'CmdOrCtrl+Shift+O', click: act('open-subtitle') },
        { label: 'Open folder as playlist…', accelerator: 'CmdOrCtrl+Shift+F', click: act('open-folder') },
        { type: 'separator' },
        { label: 'Toggle vocabulary panel  (Ctrl+B)', accelerator: 'CmdOrCtrl+B', click: act('toggle-panel') },
        { type: 'separator' },
        { role: process.platform === 'darwin' ? 'close' : 'quit', label: 'Exit  (Ctrl+Q)' },
      ],
    },
    {
      label: 'Playback / پخش',
      submenu: [
        { label: 'Play / Pause  (Space)', click: act('play-pause') },
        { label: 'Back 5 s  (←)', click: act('seek', -5) },
        { label: 'Forward 5 s  (→)', click: act('seek', 5) },
        { label: 'Back 15 s  (Shift+←)', click: act('seek', -15) },
        { label: 'Forward 15 s  (Shift+→)', click: act('seek', 15) },
        { type: 'separator' },
        { label: 'Previous subtitle line  (Shift+↑)', click: act('cue', -1) },
        { label: 'Next subtitle line  (Shift+↓)', click: act('cue', 1) },
        { label: 'Replay current line  (R)', click: act('replay-cue') },
        { type: 'separator' },
        { label: 'Speed 0.5×  ([)', click: act('rate', 0.5) },
        { label: 'Speed 0.75×', click: act('rate', 0.75) },
        { label: 'Speed 1×', click: act('rate', 1) },
        { label: 'Speed 1.25×', click: act('rate', 1.25) },
        { label: 'Speed 1.5×', click: act('rate', 1.5) },
        { label: 'Speed 2×  (])', click: act('rate', 2) },
      ],
    },
    {
      label: 'View / نما',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { label: 'Full screen  (F11)', accelerator: 'F11', click: act('fullscreen') },
        { label: 'Always on top  (T)', type: 'checkbox', checked: false, click: (item) => send('pv:menu-action', { action: 'always-on-top', arg: item.checked }) },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { role: 'resetZoom', label: 'Reset zoom' },
        { type: 'separator' },
        { label: 'Developer tools', accelerator: 'F12', click: act('devtools') },
      ],
    },
    {
      label: 'Help / راهنما',
      submenu: [
        { label: 'About ProudVocab Desktop', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'ProudVocab Desktop', message: `ProudVocab Desktop ${app.getVersion()}`, detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\nLocal-video vocabulary trainer.\nData folder:\n${DATA_DIR()}` }) },
        { label: 'Open data folder', click: () => { try { fs.mkdirSync(DATA_DIR(), { recursive: true }); shell.openPath(DATA_DIR()); } catch {} } },
        { label: 'Project page', click: () => shell.openExternal('https://github.com/mohsenamiri/proudvocab') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

module.exports = { DEV, SMOKE, RENDERER_ROOT };
