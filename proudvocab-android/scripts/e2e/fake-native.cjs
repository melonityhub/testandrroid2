/* Preload for the Electron end-to-end test: implements the same
 * `PVNative` @JavascriptInterface contract as NativeBridge.java, backed by
 * Node (fs / node:sqlite), so the REAL generated web layer can run in a
 * real Chromium. */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CFG = JSON.parse(process.env.PV_E2E_CFG);
const FIX = CFG.fixtures;
const DATA = CFG.data;
fs.mkdirSync(DATA, { recursive: true });
const STORE = path.join(DATA, 'store.json');
const DICT = path.join(DATA, 'dictionary.sqlite');

const log = { net: [], saved: [], awake: [], saves: 0, dialogs: [] };
let fullscreen = false;
let dictDb = null;

const nameOf = (p) => { const i = String(p).indexOf('#pvn='); return decodeURIComponent(String(p).slice(i + 5)); };
const mk = (name) => `content://fake/document/${encodeURIComponent(name)}#pvn=${encodeURIComponent(name)}`;
const b64 = (buf) => Buffer.from(buf).toString('base64');
const emit = (ch, o) => window.__pvNativeEmit(ch, JSON.stringify(o));

/* SQL straight out of Dictionary.java */
const javaSrc = fs.readFileSync(CFG.dictionaryJava, 'utf8');
const SQL = {};
for (const m of javaSrc.matchAll(/static final String (SQL_[A-Z_]+) = ("(?:[^"\\]|\\.)*");/g)) SQL[m[1]] = JSON.parse(m[2]);

function openDict() { if (!dictDb && fs.existsSync(DICT)) dictDb = new DatabaseSync(DICT, { readOnly: true }); return dictDb; }
const clean = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
function resolve(sql, word) { const r = openDict().prepare(sql).get(word); if (!r) return -1; const v = Object.values(r); return v[1] != null ? v[1] : v[0]; }

const handlers = {
  'pv:app-info': () => ({ version: '1.0.0-e2e', platform: 'android', arch: 'arm64', sdk: 30, device: 'POCO X3 Pro', locale: CFG.locale || 'en-US', packaged: true }),
  'pv:store-load': () => (fs.existsSync(STORE) ? { ok: true, data: JSON.parse(fs.readFileSync(STORE, 'utf8')) } : { ok: true, data: { local: { onboardingCompleted: true }, sync: {}, meta: {} } }),
  'pv:store-save': (o) => { fs.writeFileSync(STORE, JSON.stringify({ local: o.local, sync: o.sync, meta: { savedAt: Date.now() } })); log.saves++; return { ok: true }; },
  'pv:store-path': () => STORE,
  'pv:open-dialog': (o) => {
    log.dialogs.push(o && o.kind);
    const next = window.__e2e && window.__e2e.nextDialog;
    if (next) { window.__e2e.nextDialog = null; return next; }
    const list = o && o.kind === 'subtitle' ? ['clip.srt'] : ['clip.mp4', 'clip.srt'];
    return { canceled: false, filePaths: list.map(mk) };
  },
  'pv:open-directory': () => ({ canceled: false, filePaths: ['content://fake/tree/root'] }),
  'pv:list-videos': () => ({ ok: true, files: fs.readdirSync(FIX).filter((f) => /\.(mp4|mkv)$/.test(f)).map((f) => ({ name: f, path: mk(f), size: fs.statSync(path.join(FIX, f)).size })) }),
  'pv:file-info': (p) => {
    const f = path.join(FIX, nameOf(p));
    if (!fs.existsSync(f)) return { ok: false, error: 'not readable' };
    const n = nameOf(p);
    return { ok: true, name: n, dir: '', ext: path.extname(n), size: fs.statSync(f).size, mtime: 0, isVideo: /\.(mp4|mkv)$/.test(n), isSubtitle: /\.srt$/.test(n) };
  },
  'pv:read-bytes': (p) => ({ ok: true, base64: b64(fs.readFileSync(path.join(FIX, nameOf(p)))), size: 1, name: nameOf(p) }),
  'pv:scan-subtitles': () => ({ ok: true, files: fs.readdirSync(FIX).filter((f) => /\.srt$/.test(f)).map((f) => ({ name: f, path: mk(f), size: 1, exact: true, related: true })) }),
  'pv:open-external': () => true,
  'pv:show-in-folder': () => false,
  'pv:set-progress': () => true,
  'pv:is-fullscreen': () => fullscreen,
  'pv:window-action': (a) => { if (a === 'fullscreen') { fullscreen = !fullscreen; setTimeout(() => emit('pv:fullscreen-changed', { on: fullscreen }), 5); return true; } return false; },
  'pv:keep-awake': (on) => { log.awake.push(!!on); return true; },
  'pv:save-file': (o) => { log.saved.push({ name: o.name, mime: o.mime, bytes: Buffer.from(o.base64, 'base64').toString('utf8').slice(0, 40) }); return { ok: true, name: o.name }; },
  'pv:take-pending-open': () => [],
  'pv:net-fetch': (req) => {
    log.net.push(req.url);
    if (/translate\.googleapis\.com/.test(req.url)) return { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, base64: b64(JSON.stringify([[['GOOGLE-TRANSLATED', 'x', null, null, 10]], null, 'en'])) };
    return { ok: true, status: 404, statusText: 'Not Found', headers: {}, base64: b64('{}') };
  },

  'pv:dict-status': () => {
    if (!fs.existsSync(DICT)) return { installed: false };
    const d = openDict();
    return { installed: true, name: 'sample.sqlite', size: fs.statSync(DICT).size, englishWords: d.prepare('SELECT COUNT(*) c FROM english_words').get().c, persianWords: d.prepare('SELECT COUNT(*) c FROM persian_words').get().c, importedAt: 1 };
  },
  'pv:dict-pick': () => {
    emit('pv:dict-progress', { done: 1, total: 2 });
    fs.copyFileSync(CFG.sampleDb, DICT);
    dictDb = null;
    emit('pv:dict-progress', { done: 2, total: 2 });
    return { ok: true, status: handlers['pv:dict-status']() };
  },
  'pv:dict-remove': () => { dictDb = null; if (fs.existsSync(DICT)) fs.unlinkSync(DICT); return { installed: false }; },
  'pv:dict-translate': (word) => {
    const d = openDict(); if (!d) return { found: false };
    const w = String(word).trim().toLowerCase();
    if (/[\u0600-\u06FF]/.test(w)) {
      const id = resolve(SQL.SQL_FA_FIND, w); if (id < 0) return { found: false };
      const rows = d.prepare(SQL.SQL_FA_MEANINGS).all(id, 5);
      return { found: true, lang: 'Persian', word: w, translation: rows.map((r) => clean(r.english_meaning)).join(', ') };
    }
    const id = resolve(SQL.SQL_EN_FIND, w); if (id < 0) return { found: false };
    const rows = d.prepare(SQL.SQL_EN_MEANINGS).all(id, 5);
    return { found: true, lang: 'English', word: w, translation: rows.map((r) => clean(r.persian_meaning)).join('\u060c ') };
  },
  'pv:dict-search': (q) => {
    const d = openDict(); if (!d) return { items: [] };
    const rows = d.prepare(SQL.SQL_EN_SEARCH).all(String(q).toLowerCase() + '*', 30);
    return { items: rows.map((r) => ({ word: r.english_word, lang: 'English', meaning: clean(d.prepare(SQL.SQL_EN_MEANINGS).get(r.english_word_id_parent || r.english_word_id, 1)?.persian_meaning) })) };
  },
  'pv:dict-detail': (word) => {
    const d = openDict(); if (!d) return { found: false };
    const id = resolve(SQL.SQL_EN_FIND, String(word).toLowerCase()); if (id < 0) return { found: false };
    const w = d.prepare(SQL.SQL_EN_WORD).get(id);
    const meanings = d.prepare(SQL.SQL_EN_DETAILS).all(id).map((m) => ({ meaning: clean(m.persian_meaning), cefr: m.cefr, pos: d.prepare(SQL.SQL_EN_POS).all(m.english_detail_id).map((p) => ({ en: 'pos' + p.pos, fa: 'pos' + p.pos })), sentences: [], categories: [] }));
    return { found: true, lang: 'English', word: w.english_word, forms: {}, meanings, synAnt: [] };
  },
};

window.PVNative = {
  mediaBase() { return CFG.mediaBase; },
  call(id, channel, argsJson) {
    setTimeout(() => {
      try {
        const h = handlers[channel];
        if (!h) throw new Error('unknown channel: ' + channel);
        const res = h(...JSON.parse(argsJson || '[]'));
        window.__pvNativeResult(id, true, res === undefined ? 'null' : JSON.stringify(res));
      } catch (e) { window.__pvNativeResult(id, false, String(e && e.message || e)); }
    }, 0);
  },
  send() { /* net-abort etc. */ },
};
window.__e2e = { log, mk, STORE, DICT };
