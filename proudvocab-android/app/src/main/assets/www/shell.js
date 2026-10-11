/**
 * shell.js – the top-level document of the desktop app.
 * ---------------------------------------------------------------------------
 * It plays three roles at once:
 *   1. layout host  : player iframe | splitter | vocabulary-panel iframe
 *   2. message bus  : the "chrome extension" plumbing that chrome-shim.js uses
 *                     (runtime.sendMessage, ports, tabs.sendMessage, storage)
 *   3. storage owner: chrome.storage.local / .sync live here and are persisted
 *                     to  <userData>/proudvocab-data/store.json
 *
 * A hidden third iframe (bg.html) runs the ORIGINAL background.js so that the
 * CEFR lookups, Google Translate calls, dictionary API, word-family builder and
 * the whole message router of the extension keep working unchanged.
 */
(function () {
  'use strict';

  const bridge = window.pvBridge;
  const APP_ORIGIN = window.location.origin;
  const EXT_ROOT = APP_ORIGIN + '/ext/';
  const VIRTUAL_TAB_ID = 1;
  const DEFAULT_UI_LANGUAGE = 'en';
  const SUPPORTED_UI_LANGS = ['en', 'tr', 'de', 'fr', 'es'];

  /* ------------------------------------------------------------------ state */
  const store = { local: {}, sync: {}, session: {} };
  const frames = new Map();          // role -> {win, hooks, ready, ...}
  const frameOrder = [];
  const ports = new Map();           // portId -> {id, name, a, b}
  const queued = { runtime: [], tabs: [], connect: [] };
  const pendingPortPosts = [];

  /** deliver port messages that were parked before onConnect ran */
  function flushPortPosts() {
    if (!pendingPortPosts.length) return;
    const keep = [];
    for (const q of pendingPortPosts) {
      const p = ports.get(q.portId);
      if (!p || !p.alive) continue;
      const otherRole = p.a === q.side ? p.b : p.a;
      const f = frames.get(otherRole);
      if (f && f.hooks && f.ready && f.ports && f.ports.has(q.portId)) {
        try { f.hooks.deliverPortMessage(q.portId, clone(q.msg)); } catch (e) { console.error('[pv-shell] queued port post failed', e); }
      } else keep.push(q);
    }
    pendingPortPosts.length = 0;
    for (const q of keep) pendingPortPosts.push(q);
  }
  const shellStorageListeners = [];
  let portSeq = 0;
  let persistTimer = null;
  let i18nBundle = { uiLanguage: DEFAULT_UI_LANGUAGE, messages: {} };
  let englishMessages = null;
  let appInfo = { version: '1.0.0', platform: 'android', arch: 'arm64' };
  let virtualTab = {
    id: VIRTUAL_TAB_ID, index: 0, windowId: 1, active: true, highlighted: true,
    status: 'complete', incognito: false, audible: false, mutedInfo: { muted: false },
    url: 'pv-local://player', title: 'ProudVocab', favIconUrl: '',
    width: 1280, height: 720,
  };
  let desktopCfg = {
    panelVisible: true,
    dictEnabled: true,      // use the imported offline dictionary for word translations
    lastVideo: null,
    recent: [],
  };

  const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  /* ==================================================================== BUS */
  const BUS = {
    origin: APP_ORIGIN,
    get platform() { return appInfo.platform; },
    get arch() { return appInfo.arch; },
    manifest: {
      manifest_version: 3,
      name: 'ProudVocab',
      version: '1.0.0',
      description: 'Local video + subtitle vocabulary trainer (Android port).',
    },

    /* ---------------------------------------------------------- frame plumbing */
    registerFrame(role, f) {
      f.role = role;
      f.hooks = null;
      f.ready = false;
      frames.set(role, f);
      if (frameOrder.indexOf(role) < 0) frameOrder.push(role);
    },
    frame(role) { return frames.get(role); },
    attachFrameHooks(role, hooks) { const f = frames.get(role); if (f) f.hooks = hooks; },
    frameReady(role) {
      const f = frames.get(role);
      if (!f) return;
      f.ready = true;
      console.log('[pv-shell] frame ready:', role);
      flushQueues();
      if (role === 'background') {
        // Chrome fires onStartup (or onInstalled on the very first run) when the
        // service worker comes alive.
        const first = !store.local.__pvDesktopInstalled;
        setTimeout(() => {
          try {
            if (first) {
              store.local.__pvDesktopInstalled = Date.now();
              schedulePersist();
              f.hooks && f.hooks.fireLifecycle('installed', { reason: 'install' });
            } else {
              f.hooks && f.hooks.fireLifecycle('startup');
            }
          } catch (e) { console.warn('[pv-shell] lifecycle fire failed', e); }
        }, 60);
      }
      document.dispatchEvent(new CustomEvent('pv-frame-ready', { detail: { role } }));
    },

    /* ------------------------------------------------------------------- i18n */
    i18n: () => i18nBundle,
    commands: () => ([
      { name: '_execute_action', description: 'Open/close the vocabulary panel', shortcut: 'Ctrl+B' },
      { name: 'open_video', description: 'Open a local video file', shortcut: 'Ctrl+O' },
      { name: 'open_subtitle', description: 'Open an SRT subtitle file', shortcut: 'Ctrl+Shift+O' },
      { name: 'seek_back', description: 'Jump back 5 seconds', shortcut: '←' },
      { name: 'seek_forward', description: 'Jump forward 5 seconds', shortcut: '→' },
      { name: 'prev_cue', description: 'Previous subtitle line', shortcut: 'Shift+↑' },
      { name: 'next_cue', description: 'Next subtitle line', shortcut: 'Shift+↓' },
      { name: 'replay_cue', description: 'Replay the current subtitle line', shortcut: 'R' },
      { name: 'fullscreen', description: 'Toggle full screen', shortcut: 'F11' },
    ]),
    config: () => clone(desktopCfg),
    getURL: (p) => EXT_ROOT + String(p || '').replace(/^\/+/, ''),
    openExternal: (url) => { if (url && !/^chrome(-extension)?:\/\//i.test(url)) bridge.invoke('pv:open-external', url); else if (url) console.info('[pv-shell] blocked chrome:// URL', url); },
    openLocalId: (u) => { const f = frames.get('player'); if (f && f.win && f.win.__pvDesktop) f.win.__pvDesktop.openLocalId(u); },
    setPanelVisible: (v) => setPanelVisible(!!v),

    /** player -> top bar */
    setNowPlaying(info) {
      const el = document.getElementById('now-playing-text');
      const wrap = document.getElementById('now-playing');
      if (el) el.textContent = info && info.name ? info.name : (i18nBundle.messages.now_playing_empty ? i18nBundle.messages.now_playing_empty.message : 'No video loaded');
      if (wrap) {
        wrap.classList.toggle('has-video', !!(info && info.hasVideo));
        wrap.title = (info && info.name) || '';
      }
      const t = document.title;
      if (info && info.name) document.title = info.name + ' · ProudVocab';
      else if (t.indexOf('·') > 0) document.title = 'ProudVocab';
    },

    /* -------------------------------------------------------------------- tabs */
    getTab: () => clone(virtualTab),
    getTabs: () => [clone(virtualTab)],
    setTabInfo(info) {
      let changed = false;
      for (const k of ['url', 'title']) {
        if (info[k] != null && info[k] !== virtualTab[k]) { virtualTab[k] = info[k]; changed = true; }
      }
      if (changed) {
        for (const role of ['panel', 'background']) {
          const f = frames.get(role);
          if (f && f.hooks && f.ready) {
            try { f.hooks.deliverTabEvent('updated', virtualTab.id, { status: 'complete', url: virtualTab.url }, clone(virtualTab)); } catch (e) { /* ignore */ }
          }
        }
      }
    },

    /* ----------------------------------------------------------------- runtime */
    runtimeSend(fromRole, msg) {
      if (msg && msg.action === 'translate' && dictWanted(msg)) {
        return dictTranslate(msg).then((res) => res || BUS.runtimeSendCore(fromRole, msg));
      }
      return BUS.runtimeSendCore(fromRole, msg);
    },

    runtimeSendCore(fromRole, msg) {
      return new Promise((resolve) => {
        const targets = frameOrder.filter((r) => r !== fromRole && (r === 'background' || r === 'panel'));
        const sender = {
          id: 'proudvocab-desktop',
          origin: APP_ORIGIN,
          url: fromRole === 'player' ? virtualTab.url : (fromRole === 'panel' ? EXT_ROOT + 'sidepanel/panel.html' : APP_ORIGIN + '/bg.html'),
        };
        if (fromRole === 'player') sender.tab = clone(virtualTab);
        let settled = false;
        const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
        const deliver = () => {
          for (const role of targets) {
            const f = frames.get(role);
            if (!f || !f.hooks) continue;
            if (!f.ready) { queued.runtime.push({ role, msg, sender, finish, ts: Date.now() }); continue; }
            try {
              const done = f.hooks.deliverRuntimeMessage(clone(msg), clone(sender), (res) => finish(res === undefined ? { __pvNoResponse: 1 } : res));
              if (done) return;
            } catch (e) { console.error('[pv-shell] runtime delivery error', e); }
          }
          finish({ __pvError: 'Could not establish connection. Receiving end does not exist.' });
        };
        if (!targets.length) return finish({ __pvError: 'Could not establish connection. Receiving end does not exist.' });
        deliver();
        return undefined;
      });
    },

    tabsSend(tabId, msg, fromRole) {
      return new Promise((resolve) => {
        const role = 'player'; // the only content-script frame in this app
        const f = frames.get(role);
        const sender = { id: 'proudvocab-desktop', origin: APP_ORIGIN, url: virtualTab.url, tab: clone(virtualTab), frameId: 0 };
        if (!f || !f.hooks) return resolve({ __pvError: 'Could not establish connection. Receiving end does not exist.' });
        if (!f.ready) { queued.tabs.push({ role, msg, sender, resolve }); return undefined; }
        try {
          const done = f.hooks.deliverRuntimeMessage(clone(msg), clone(sender), (res) => resolve(res === undefined ? { __pvNoResponse: 1 } : res));
          if (!done) resolve({ __pvError: 'The message port closed before a response was received.' });
        } catch (e) {
          console.error('[pv-shell] tabs.sendMessage error', e);
          resolve({ __pvError: String(e && e.message || e) });
        }
        return undefined;
      });
    },

    /* ------------------------------------------------------------------- ports */
    portCreate(fromRole, name) {
      const id = 'port-' + (++portSeq);
      const other = fromRole === 'background' ? 'panel' : 'background';
      ports.set(id, { id, name, a: fromRole, b: other, alive: true });
      const f = frames.get(other);
      const connect = () => {
        try { f.hooks.deliverConnect(id, name, other); } catch (e) { console.error('[pv-shell] onConnect delivery failed', e); }
        flushPortPosts();
      };
      if (f && f.hooks && f.ready) setTimeout(connect, 0);
      else queued.connect.push({ other, connect });
      return id;
    },
    portPost(portId, side, msg) {
      const p = ports.get(portId);
      if (!p || !p.alive) return;
      const otherRole = p.a === side ? p.b : p.a;
      const f = frames.get(otherRole);
      /* the other end may not have run its onConnect handler yet (Chrome is
         asynchronous here) – park the message instead of dropping it. */
      if (f && f.hooks && f.ready && (!f.ports || f.ports.has(portId))) {
        try { f.hooks.deliverPortMessage(portId, clone(msg)); } catch (e) { console.error('[pv-shell] port post failed', e); }
        return;
      }
      pendingPortPosts.push({ portId, side, msg: clone(msg) });
      if (pendingPortPosts.length > 500) pendingPortPosts.shift();
    },
    portDisconnect(portId, side) {
      const p = ports.get(portId);
      if (!p || !p.alive) return;
      p.alive = false;
      const otherRole = p.a === side ? p.b : p.a;
      const f = frames.get(otherRole);
      if (f && f.hooks) { try { f.hooks.deliverPortDisconnect(portId); } catch (e) { /* ignore */ } }
      ports.delete(portId);
      if (side === 'panel') setPanelConnected(false);
    },

    /* ----------------------------------------------------------------- storage */
    storageGet(area) { return store[area] || (store[area] = {}); },
    storageSet(area, items) {
      if (!items || typeof items !== 'object') return;
      items = unlockLicense(area, items);
      const cur = store[area] || (store[area] = {});
      const changes = {};
      for (const k of Object.keys(items)) {
        const nv = items[k];
        const had = Object.prototype.hasOwnProperty.call(cur, k);
        const ov = had ? cur[k] : undefined;
        if (had && sameValue(ov, nv)) continue;
        if (nv === undefined) { if (had) { changes[k] = { oldValue: ov }; delete cur[k]; } continue; }
        changes[k] = had ? { oldValue: ov, newValue: nv } : { newValue: nv };
        cur[k] = nv;
      }
      if (!Object.keys(changes).length) return;
      schedulePersist();
      broadcastStorage(changes, area);
    },
    storageRemove(area, keys) {
      const cur = store[area] || (store[area] = {});
      const changes = {};
      for (const k of (Array.isArray(keys) ? keys : [keys])) {
        if (Object.prototype.hasOwnProperty.call(cur, k)) { changes[k] = { oldValue: cur[k] }; delete cur[k]; }
      }
      if (!Object.keys(changes).length) return;
      schedulePersist();
      broadcastStorage(changes, area);
      if (area === 'local') seedLicense();
    },
    storageClear(area) {
      const cur = store[area] || {};
      const changes = {};
      for (const k of Object.keys(cur)) changes[k] = { oldValue: cur[k] };
      store[area] = {};
      if (!Object.keys(changes).length) return;
      schedulePersist();
      broadcastStorage(changes, area);
      if (area === 'local') seedLicense();
    },

    /* ----------------------------------------------------------------- network */
    netFetch: (req) => bridge.invoke('pv:net-fetch', req),
    netAbort: (id) => bridge.send('pv:net-abort', id),

    /* ------------------------------------------------- desktop-only utilities */
    /** diagnostics – used by `npm run smoke` and by the devtools console */
    debugInfo() {
      return {
        frames: frameOrder.map((r) => {
          const f = frames.get(r) || {};
          return { role: r, ready: !!f.ready, hasHooks: !!f.hooks, alive: !!(f.win && !f.win.closed) };
        }),
        ports: Array.from(ports.values()).map((p) => ({ id: p.id, name: p.name, a: p.a, b: p.b, alive: p.alive })),
        queued: { runtime: queued.runtime.length, tabs: queued.tabs.length, connect: queued.connect.length },
        store: {
          localKeys: Object.keys(store.local),
          syncKeys: Object.keys(store.sync),
          savedWords: (store.local.savedWords || []).length,
        },
        i18n: { lang: i18nBundle.uiLanguage, keys: Object.keys(i18nBundle.messages || {}).length },
        tab: clone(virtualTab),
        cfg: clone(desktopCfg),
        appInfo: clone(appInfo),
      };
    },
    shell: {
      get appInfo() { return clone(appInfo); },
      get store() { return store; },
      desktopCfg,
      saveDesktopCfg(patch) {
        Object.assign(desktopCfg, patch || {});
        store.local.__pvDesktop = clone(desktopCfg);
        schedulePersist();
      },
      playerFrame: () => frames.get('player') && frames.get('player').win,
      panelFrame: () => frames.get('panel') && frames.get('panel').win,
      callPlayer(fn, ...args) {
        const w = frames.get('player') && frames.get('player').win;
        if (w && w.__pvDesktop && typeof w.__pvDesktop[fn] === 'function') return w.__pvDesktop[fn](...args);
        return undefined;
      },
      onStorageChange(fn) { shellStorageListeners.push(fn); },
      reloadI18n: (lang) => loadI18n(lang),
      openDictionary,
      refreshDictStatus,
    },
  };

  function sameValue(a, b) {
    if (a === b) return true;
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  function broadcastStorage(changes, area) {
    const payload = clone(changes);
    for (const role of frameOrder) {
      const f = frames.get(role);
      if (!f || !f.hooks || !f.ready) continue;
      try { f.hooks.deliverStorageChange(payload, area); } catch (e) { console.error('[pv-shell] storage change delivery failed', e); }
    }
    for (const fn of shellStorageListeners) { try { fn(clone(changes), area); } catch (e) { console.error(e); } }
    if (area === 'sync' || area === 'local') maybeReloadI18n(changes, area);
  }

  function maybeReloadI18n(changes, area) {
    if (!changes.settings) return;
    // Resetting/removing settings must restore English, not the phone's locale.
    const want = resolveMenuLanguage();
    if (want !== desktopCfg.__lastAppLanguage) loadI18n(want).catch(() => {});
    void area;
  }

  function flushQueues() {
    for (let i = queued.runtime.length - 1; i >= 0; i--) {
      const q = queued.runtime[i];
      const f = frames.get(q.role);
      if (f && f.ready && f.hooks) {
        queued.runtime.splice(i, 1);
        try {
          const done = f.hooks.deliverRuntimeMessage(clone(q.msg), clone(q.sender), (res) => q.finish(res === undefined ? { __pvNoResponse: 1 } : res));
          if (!done) q.finish({ __pvError: 'The message port closed before a response was received.' });
        } catch (e) { q.finish({ __pvError: String(e && e.message || e) }); }
      }
    }
    for (let i = queued.tabs.length - 1; i >= 0; i--) {
      const q = queued.tabs[i];
      const f = frames.get(q.role);
      if (f && f.ready && f.hooks) {
        queued.tabs.splice(i, 1);
        try {
          const done = f.hooks.deliverRuntimeMessage(clone(q.msg), clone(q.sender), (res) => q.resolve(res === undefined ? { __pvNoResponse: 1 } : res));
          if (!done) q.resolve({ __pvError: 'The message port closed before a response was received.' });
        } catch (e) { q.resolve({ __pvError: String(e && e.message || e) }); }
      }
    }
    for (let i = queued.connect.length - 1; i >= 0; i--) {
      const q = queued.connect[i];
      const f = frames.get(q.other);
      if (f && f.ready && f.hooks) { queued.connect.splice(i, 1); q.connect(); }
    }
  }

  function setPanelConnected(on) {
    const st = document.getElementById('panel-status');
    if (st) st.classList.toggle('off', !on);
  }

  /* ================================================================ storage */
  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      bridge.invoke('pv:store-save', { local: store.local, sync: store.sync }).catch((e) => console.error('[pv-shell] persist failed', e));
    }, 400);
  }

  /* ==================================================================== i18n */
  function resolveMenuLanguage(explicit) {
    const stored = (store.sync.settings && store.sync.settings.appLanguage) ||
      (store.local.settings && store.local.settings.appLanguage);
    const lang = String(explicit || stored || DEFAULT_UI_LANGUAGE).toLowerCase().split(/[-_]/)[0];
    // Legacy "auto", missing and unsupported preferences use English. The menu
    // language is independent of both the phone locale and translation target.
    return SUPPORTED_UI_LANGS.includes(lang) ? lang : DEFAULT_UI_LANGUAGE;
  }

  function initializeMenuLanguage() {
    const migrate = !store.local.__pvEnglishMenuV2;
    const localSettings = store.local.settings || {};
    const syncSettings = store.sync.settings || {};
    const settings = { ...localSettings, ...syncSettings };
    for (const platform of ['local', 'youtube', 'prime', 'netflix']) {
      if (localSettings[platform] && syncSettings[platform]) {
        settings[platform] = { ...localSettings[platform], ...syncSettings[platform] };
      }
    }
    settings.appLanguage = migrate ? DEFAULT_UI_LANGUAGE : resolveMenuLanguage(settings.appLanguage);
    if (!migrate && sameValue(store.sync.settings, settings)) return;

    store.sync.settings = settings;
    if (migrate && store.local.settings) {
      store.local.settings = { ...localSettings, appLanguage: DEFAULT_UI_LANGUAGE };
    }
    // V1 only changed the shell preference; its marker must not prevent this
    // repair for installs that still have Turkish menus. Later manual choices
    // are preserved, as are vocabulary, SRS and translation preferences.
    store.local.__pvEnglishMenuV2 = true;
    schedulePersist();
  }

  async function fetchMessages(lang) {
    const res = await fetch(`${EXT_ROOT}_locales/${lang}/messages.json`);
    if (!res.ok) throw new Error(`Could not load ${lang} messages: HTTP ${res.status}`);
    return res.json();
  }

  async function loadI18n(explicit) {
    const lang = resolveMenuLanguage(explicit);
    try {
      if (!englishMessages) englishMessages = await fetchMessages(DEFAULT_UI_LANGUAGE);
      const messages = lang === DEFAULT_UI_LANGUAGE ? englishMessages : await fetchMessages(lang);
      i18nBundle = { uiLanguage: lang, messages: { ...englishMessages, ...messages } };
      document.documentElement.lang = lang;
      desktopCfg.__lastAppLanguage = lang;
      document.dispatchEvent(new CustomEvent('pv-language-changed', { detail: { language: lang } }));
    } catch (e) {
      console.warn('[pv-shell] could not load locale', lang, e);
      if (lang !== DEFAULT_UI_LANGUAGE) return loadI18n(DEFAULT_UI_LANGUAGE);
    }
    return i18nBundle;
  }

  /* ================================================================== frames */
  function makeFrame(id, src, cls) {
    const f = document.createElement('iframe');
    f.id = id;
    f.className = cls || '';
    f.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    f.setAttribute('allowfullscreen', 'true');
    f.src = src;
    return f;
  }

  function createFrames() {
    const bg = makeFrame('bg-frame', APP_ORIGIN + '/bg.html', 'bg-frame');
    document.body.appendChild(bg);

    const player = makeFrame('player-frame', APP_ORIGIN + '/player/player.html', 'player-frame');
    document.getElementById('stage').appendChild(player);

    const panel = makeFrame('panel-frame', EXT_ROOT + 'sidepanel/panel.html', 'panel-frame');
    document.getElementById('panel-wrap').appendChild(panel);

    window.addEventListener('beforeunload', () => {
      clearTimeout(persistTimer);
      try { bridge.invoke('pv:store-save', { local: store.local, sync: store.sync }); } catch { /* ignore */ }
    });
  }

  /* ================================================================== layout */
  function setPanelVisible(v) {
    desktopCfg.panelVisible = v;
    document.body.classList.toggle('panel-hidden', !v);
    BUS.shell.saveDesktopCfg({ panelVisible: v });
    const btn = document.getElementById('btn-panel');
    if (btn) btn.classList.toggle('active', v);
  }

  /* On a phone the panel is not resizable: portrait = video on top, panel
   * below; landscape = video left, panel right (see shell.css). */
  function initLayout() {
    setPanelVisible(desktopCfg.panelVisible !== false);

    document.getElementById('btn-panel').addEventListener('click', () => setPanelVisible(!desktopCfg.panelVisible));
    document.getElementById('btn-fullscreen').addEventListener('click', () => bridge.invoke('pv:window-action', 'fullscreen'));
    document.getElementById('btn-dict').addEventListener('click', () => openDictionary());
    document.getElementById('dict-overlay').addEventListener('click', (e) => { if (e.target.id === 'dict-overlay') closeDictionary(); });

    bridge.on('pv:fullscreen-changed', (o) => document.body.classList.toggle('pv-fs', !!(o && o.on)));
  }

  /* ============================================== premium / license removal */
  /* The original extension gates features behind a paid license. Everything
   * is unlocked in this build: the state below is what a lifetime license
   * would store, and any attempt to write a "free" state is coerced back. */
  const UNLOCKED = {
    isPremium: true,
    licenseType: 'LIFETIME',
    licenseStatus: 'ACTIVE',
    licenseExpiration: '',
    dailyUsage: 0,
  };

  function unlockLicense(area, items) {
    if (area !== 'local') return items;
    const out = Object.assign({}, items);
    if ('isPremium' in out) out.isPremium = true;
    if ('licenseType' in out && (!out.licenseType || out.licenseType === 'FREE')) out.licenseType = 'LIFETIME';
    if ('licenseStatus' in out) out.licenseStatus = 'ACTIVE';
    if ('dailyUsage' in out && typeof out.dailyUsage !== 'number') out.dailyUsage = 0;
    return out;
  }

  function seedLicense() {
    const cur = store.local;
    const need = {};
    for (const k of Object.keys(UNLOCKED)) {
      if (cur[k] === undefined || (k === 'isPremium' && cur[k] !== true) || (k === 'licenseType' && cur[k] === 'FREE') || (k === 'licenseStatus' && cur[k] !== 'ACTIVE')) need[k] = UNLOCKED[k];
    }
    if (Object.keys(need).length) BUS.storageSet('local', need);
  }

  /* ================================================== offline dictionary */
  let dictStatus = { installed: false };

  async function refreshDictStatus() {
    try { dictStatus = await bridge.invoke('pv:dict-status'); } catch (e) { dictStatus = { installed: false }; }
    document.body.classList.toggle('has-dict', !!dictStatus.installed);
    return dictStatus;
  }

  function targetLangOf(msg) {
    const st = (store.sync.settings || store.local.settings || {});
    return String(msg.targetLang || st.targetLang || 'tr').toLowerCase().slice(0, 2);
  }

  /** English -> Persian and Persian -> English words / short phrases only */
  function dictWanted(msg) {
    if (!dictStatus.installed || desktopCfg.dictEnabled === false) return false;
    const w = String(msg.word || '').trim();
    if (!w || w.length > 80 || w.split(/\s+/).length > 5) return false;
    const tl = targetLangOf(msg);
    const isFa = /[\u0600-\u06FF]/.test(w);
    return (tl === 'fa' && !isFa) || (tl === 'en' && isFa);
  }

  async function dictTranslate(msg) {
    try {
      const r = await bridge.invoke('pv:dict-translate', String(msg.word));
      if (r && r.found && r.translation) return { success: true, translation: r.translation, detectedLang: r.lang === 'Persian' ? 'fa' : 'en', source: 'offline-dictionary' };
    } catch (e) { console.warn('[pv-shell] dictionary lookup failed', e); }
    return null;
  }

  function openDictionary(word) {
    const ov = document.getElementById('dict-overlay');
    const fr = document.getElementById('dict-frame');
    if (!fr.getAttribute('src')) fr.setAttribute('src', APP_ORIGIN + '/dict/dict.html');
    ov.hidden = false;
    document.body.classList.add('dict-open');
    try { if (fr.contentWindow && fr.contentWindow.__pvDictOpen) fr.contentWindow.__pvDictOpen(word || ''); } catch (e) { /* not loaded yet */ }
  }

  function closeDictionary() {
    document.getElementById('dict-overlay').hidden = true;
    document.body.classList.remove('dict-open');
    refreshDictStatus();
  }

  /** Android Back button: close the top-most thing the web UI has open */
  window.__pvOnBack = function () {
    const ov = document.getElementById('dict-overlay');
    if (ov && !ov.hidden) {
      const fr = document.getElementById('dict-frame');
      try { if (fr.contentWindow.__pvDictBack && fr.contentWindow.__pvDictBack()) return true; } catch (e) { /* ignore */ }
      closeDictionary();
      return true;
    }
    const pw = frames.get('panel') && frames.get('panel').win;
    try {
      const open = pw && pw.document.querySelectorAll('.srs-overlay.open');
      if (open && open.length) {
        const top = open[open.length - 1];
        const btn = top.querySelector('.srs-overlay-header .nav-icon, #menu-back-btn, #profile-close');
        if (btn) { btn.click(); return true; }
      }
    } catch (e) { /* ignore */ }
    return false;
  };

  /** Activity.onPause: make sure nothing is lost */
  window.__pvFlush = function () {
    clearTimeout(persistTimer);
    try { bridge.invoke('pv:store-save', { local: store.local, sync: store.sync }); } catch (e) { /* ignore */ }
  };

  /* ================================================================ startup */
  async function start() {
    try { appInfo = await bridge.invoke('pv:app-info'); } catch (e) { console.warn('[pv-shell] app-info failed', e); }
    BUS.manifest.version = appInfo.version || '1.0.0';

    let loaded = { ok: false, data: { local: {}, sync: {} } };
    try { loaded = await bridge.invoke('pv:store-load'); } catch (e) { console.warn('[pv-shell] store-load failed', e); }
    store.local = (loaded && loaded.data && loaded.data.local) || {};
    store.sync = (loaded && loaded.data && loaded.data.sync) || {};
    if (store.local.__pvDesktop && typeof store.local.__pvDesktop === 'object') Object.assign(desktopCfg, store.local.__pvDesktop);

    initializeMenuLanguage();
    seedLicense();
    await refreshDictStatus();
    await loadI18n();
    initLayout();
    createFrames();

    /* main-process events -------------------------------------------------- */
    const openWhenReady = (filePaths) => {
      if (!filePaths || !filePaths.length) return;
      const f = frames.get('player');
      const go = () => { const w = frames.get('player') && frames.get('player').win; if (w && w.__pvDesktop) w.__pvDesktop.openFiles(filePaths); };
      if (f && f.ready) go();
      else document.addEventListener('pv-frame-ready', (e) => { if (e.detail.role === 'player') setTimeout(go, 50); }, { once: true });
    };
    bridge.on('pv:open-files', ({ filePaths }) => openWhenReady(filePaths));
    bridge.invoke('pv:take-pending-open').then(openWhenReady).catch(() => {});

    window.__pvBus_ready = true;
    document.dispatchEvent(new CustomEvent('pv-shell-ready'));

    /* hide the boot overlay as soon as the player frame reports in */
    const killBoot = () => {
      const b = document.getElementById('boot');
      document.body.classList.remove('booting');
      if (b) { b.classList.add('gone'); setTimeout(() => b.remove(), 400); }
    };
    document.addEventListener('pv-frame-ready', (e) => { if (e.detail.role === 'player') setTimeout(killBoot, 120); });
    setTimeout(killBoot, 6000); // never let a failed frame keep the splash up
  }

  function handleMenuAction(action, arg) {
    switch (action) {
      case 'toggle-panel': setPanelVisible(!desktopCfg.panelVisible); break;
      case 'fullscreen': bridge.invoke('pv:window-action', 'fullscreen'); break;
      case 'open-video': BUS.shell.callPlayer('pickVideo'); break;
      case 'open-subtitle': BUS.shell.callPlayer('pickSubtitle'); break;
      case 'open-folder': BUS.shell.callPlayer('pickFolder'); break;
      default: BUS.shell.callPlayer('menuAction', action, arg);
    }
  }

  window.__pvBus = BUS;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
