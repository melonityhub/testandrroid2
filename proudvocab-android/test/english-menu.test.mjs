import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { renderEnglishPanel } from '../scripts/english-ui.mjs';

const source = fs.readFileSync(new URL('../web-overlay/shell.js', import.meta.url), 'utf8');
const www = new URL('../app/src/main/assets/www/', import.meta.url);
const readAsset = (file) => fs.readFileSync(new URL(file, www), 'utf8');
const english = JSON.parse(readAsset('ext/_locales/en/messages.json'));
const plain = (value) => JSON.parse(JSON.stringify(value));

// Exercise the entire shell startup, not a substring of the migration. Frames
// must be created only after the migrated preference and English bundle exist.
async function boot(data = { local: {}, sync: {} }, { phoneLanguage = 'tr-TR', failLocale } = {}) {
  const listeners = new Map();
  const events = [];
  const frameLanguages = [];
  const elements = new Map();
  const timers = new Map();
  const requests = [];
  let timerId = 0;
  let persisted;
  let window;
  const element = () => ({
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild(frame) { frameLanguages.push(window.__pvBus.i18n().uiLanguage); },
    setAttribute() {},
    remove() {},
  });
  const document = {
    readyState: 'loading',
    documentElement: { lang: 'tr' },
    body: element(),
    createElement: element,
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      events.push(event);
      for (const callback of listeners.get(event.type) || []) callback(event);
    },
  };
  window = {
    location: { origin: 'http://proudvocab.test' },
    addEventListener() {},
    pvBridge: {
      on() {},
      async invoke(channel, value) {
        if (channel === 'pv:app-info') return { platform: 'android', locale: phoneLanguage };
        if (channel === 'pv:store-load') return { ok: true, data: plain(data) };
        if (channel === 'pv:store-save') { persisted = plain(value); return { ok: true }; }
        if (channel === 'pv:dict-status') return { installed: false };
        if (channel === 'pv:take-pending-open') return [];
        throw new Error(`Unexpected bridge channel: ${channel}`);
      },
    },
  };
  const context = {
    window, document,
    navigator: { language: phoneLanguage },
    console: { log() {}, info() {}, warn() {}, error() {} },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    async fetch(url) {
      requests.push(url);
      const lang = /_locales\/([^/]+)\//.exec(url)?.[1];
      return {
        ok: lang !== failLocale, status: lang === failLocale ? 404 : 200,
        async json() { return JSON.parse(readAsset(`ext/_locales/${lang}/messages.json`)); },
      };
    },
  };
  vm.runInNewContext(source, context, { filename: 'shell.js' });
  await listeners.get('DOMContentLoaded')[0]();
  return { bus: window.__pvBus, window, document, events, requests, frameLanguages, persisted: () => persisted };
}

for (const appLanguage of [undefined, 'auto', 'tr']) {
  test(`startup repairs ${appLanguage || 'missing'} menu preference before creating frames`, async () => {
    const settings = { appLanguage, targetLang: 'fa', local: { sourceLang: 'en', targetLang: 'fa', dualSubtitles: true } };
    const words = [{ word: 'hello', translation: 'سلام', nextReview: 12345 }];
    const app = await boot({ local: { savedWords: words, srsStreakStats: { currentStreak: 8 } }, sync: { settings } });
    assert.equal(app.bus.shell.store.sync.settings.appLanguage, 'en');
    assert.equal(app.bus.shell.store.sync.settings.targetLang, 'fa');
    assert.deepEqual(plain(app.bus.shell.store.sync.settings.local), settings.local);
    assert.deepEqual(plain(app.bus.shell.store.local.savedWords), words);
    assert.equal(app.bus.shell.store.local.srsStreakStats.currentStreak, 8);
    assert.equal(app.bus.shell.store.local.__pvEnglishMenuV2, true);
    assert.equal(app.document.documentElement.lang, 'en');
    assert.deepEqual(app.frameLanguages, ['en', 'en', 'en']);
    assert.equal(app.bus.i18n().messages.menu_title.message, 'Menu');
    app.window.__pvFlush();
    assert.equal(app.persisted().sync.settings.appLanguage, 'en');
  });
}

test('the old V1 marker does not skip repairing a still-Turkish installation', async () => {
  const app = await boot({
    local: { __pvEnglishMenuV1: true, settings: { appLanguage: 'tr', targetLang: 'fa' } },
    sync: { settings: { appLanguage: 'tr', local: { targetLang: 'fa' } } },
  });
  assert.equal(app.bus.shell.store.sync.settings.appLanguage, 'en');
  assert.equal(app.bus.shell.store.local.settings.appLanguage, 'en');
  assert.equal(app.bus.shell.store.sync.settings.targetLang, 'fa');
  assert.equal(app.bus.shell.store.sync.settings.local.targetLang, 'fa');
});

test('local and sync translation settings survive, including partially saved platform preferences', async () => {
  const app = await boot({
    local: { settings: { targetLang: 'fa', local: { sourceLang: 'en', dualSubtitles: false, fontSize: '30px' } } },
    sync: { settings: { appLanguage: 'tr', local: { targetLang: 'fa', fontSize: '22px' }, gamesSound: false } },
  });
  assert.deepEqual(plain(app.bus.shell.store.sync.settings), {
    appLanguage: 'en', targetLang: 'fa', gamesSound: false,
    local: { sourceLang: 'en', targetLang: 'fa', dualSubtitles: false, fontSize: '22px' },
  });
});

for (const settings of [undefined, {}, { appLanguage: 'auto', targetLang: 'fa' }, { appLanguage: 'xx', targetLang: 'fa' }]) {
  test(`English remains the default after migration/reset: ${JSON.stringify(settings)}`, async () => {
    const app = await boot({ local: { __pvEnglishMenuV2: true }, sync: { settings } }, { phoneLanguage: 'tr-TR' });
    assert.equal(app.bus.shell.store.sync.settings.appLanguage, 'en');
    assert.equal(app.bus.shell.store.sync.settings.targetLang, settings?.targetLang);
    assert.equal(app.bus.i18n().uiLanguage, 'en');
  });
}

for (const appLanguage of ['tr', 'de']) {
  test(`a later explicit ${appLanguage} choice is preserved on restart`, async () => {
    const app = await boot();
    app.bus.storageSet('sync', { settings: { appLanguage, targetLang: 'fa' } });
    await app.bus.shell.reloadI18n(appLanguage);
    const restarted = await boot(plain(app.bus.shell.store));
    assert.equal(restarted.bus.shell.store.sync.settings.appLanguage, appLanguage);
    assert.equal(restarted.bus.shell.store.sync.settings.targetLang, 'fa');
    assert.equal(restarted.bus.i18n().uiLanguage, appLanguage);
    assert.equal(restarted.document.documentElement.lang, appLanguage);
  });
}

test('legacy auto resolves to English even on a Turkish phone with a Turkish saved preference', async () => {
  const app = await boot({ local: { __pvEnglishMenuV2: true }, sync: { settings: { appLanguage: 'tr' } } });
  await app.bus.shell.reloadI18n('auto');
  assert.equal(app.bus.i18n().uiLanguage, 'en');
});

test('removing settings restores English in the running shell', async () => {
  const app = await boot({ local: { __pvEnglishMenuV2: true }, sync: { settings: { appLanguage: 'tr' } } });
  app.bus.storageRemove('sync', 'settings');
  await new Promise(setImmediate);
  assert.equal(app.bus.i18n().uiLanguage, 'en');
  assert.equal(app.events.at(-1).detail.language, 'en');
});

test('missing messages in another UI language fall back to English, not Turkish', async () => {
  const app = await boot({ local: { __pvEnglishMenuV2: true }, sync: { settings: { appLanguage: 'de' } } });
  assert.equal(app.bus.i18n().uiLanguage, 'de');
  assert.equal(app.bus.i18n().messages.modal_btn_close.message, 'Close');
});

test('a failed locale request falls back to the English bundle', async () => {
  const app = await boot({ local: { __pvEnglishMenuV2: true }, sync: { settings: { appLanguage: 'de' } } }, { failLocale: 'de' });
  assert.equal(app.bus.i18n().uiLanguage, 'en');
  assert.equal(app.bus.i18n().messages.menu_title.message, 'Menu');
});

for (const appLanguage of [undefined, 'auto', 'en']) {
  test(`panel/content i18n defaults to English with ${appLanguage || 'missing'} settings and a Turkish browser`, async () => {
    const document = { documentElement: {} };
    const requests = [];
    const context = {
      document, window: { addEventListener() {} }, navigator: { language: 'tr-TR' },
      console: { log() {}, error() {} },
      chrome: {
        runtime: { getURL: (file) => file, sendMessage: () => Promise.resolve() },
        i18n: { getUILanguage: () => 'tr-TR', getMessage: (key) => english[key]?.message || '' },
        storage: { sync: { get: (defaults, callback) => callback({ settings: { appLanguage } }) } },
      },
      async fetch(url) {
        requests.push(url);
        return { async json() { return JSON.parse(readAsset('ext/' + url)); } };
      },
    };
    vm.runInNewContext(readAsset('ext/content/utils_common.js'), context);
    await context.initI18n();
    assert.equal(document.documentElement.lang, 'en');
    assert.deepEqual(requests, ['_locales/en/messages.json']);
    assert.equal(context.getMessage('menu_title'), 'Menu');
  });
}

test('the generated panel renders English before runtime localization', () => {
  const html = readAsset('ext/sidepanel/panel.html');
  assert.match(html, /<html lang="en">/);
  assert.match(html, /data-i18n="menu_title">Menu<\/span>/);
  assert.match(html, /id="appLangLabel">English<\/span>/);
  const menu = /id="appLangMenu">([\s\S]*?)<\/div>/.exec(html)[1];
  const selected = [...menu.matchAll(/class="material-select-opt on" data-val="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(selected, ['en']);
  assert.match(/id="app-lang-select"[^>]*>([\s\S]*?)<\/select>/.exec(html)[1], /value="en"[^>]* selected/);
  for (const [, key] of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) {
    assert.ok(english[key]?.message, `Missing English translation for ${key}`);
  }
});

test('English messages cover all literal side-panel getMessage calls', () => {
  const panelDir = new URL('ext/sidepanel/', www);
  for (const file of fs.readdirSync(panelDir).filter((name) => name.endsWith('.js'))) {
    for (const [, key] of readAsset('ext/sidepanel/' + file).matchAll(/getMessage\("([^"]+)"\)/g)) {
      assert.ok(english[key]?.message, `${file}: missing English translation for ${key}`);
    }
  }
});

test('English prerender preserves the hint icon and fails on missing translations', () => {
  const vendor = fs.readFileSync(new URL('./fixtures/turkish-panel.html', import.meta.url), 'utf8');
  const html = renderEnglishPanel(vendor, english);
  assert.match(html, /id="srs-hint-btn">\s*<svg[\s\S]*?<span data-i18n="srs_card_hint_btn">/);
  assert.throws(() => renderEnglishPanel(vendor, { ...english, menu_title: undefined }), /Missing English UI message: menu_title/);
});

test('the checked-in shell and player use the same menu language policy', () => {
  assert.equal(readAsset('shell.js'), source);
  const player = readAsset('player/player.js');
  assert.doesNotMatch(player, /nav\.startsWith\('fa'\)/);
  assert.match(player, /pv-language-changed', applyI18n/);
  assert.doesNotMatch(readAsset('ext/sidepanel/panel_settings.js'), /appLanguage\|\|"(?:tr|auto)"/);
});
