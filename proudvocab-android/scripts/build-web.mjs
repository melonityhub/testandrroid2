#!/usr/bin/env node
/**
 * build-web.mjs - produces app/src/main/assets/www from
 *   1. the desktop port's renderer   (../proudvocab-desktop/src/renderer)
 *   2. the Android overlay           (web-overlay/)
 *   3. the license / premium removal patches below
 *
 * Every patch asserts how many places it changes. If the desktop sources
 * change in a way that moves a patch point, the build FAILS LOUDLY instead of
 * silently shipping a half-unlocked app.
 *
 *   node scripts/build-web.mjs [path/to/proudvocab-desktop/src/renderer]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderEnglishPanel } from './english-ui.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.resolve(process.argv[2] || path.join(ROOT, '..', 'proudvocab-desktop', 'src', 'renderer'));
const OUT = path.join(ROOT, 'app', 'src', 'main', 'assets', 'www');
const OVL = path.join(ROOT, 'web-overlay');

if (!fs.existsSync(path.join(SRC, 'ext', 'background.js'))) {
  // The Android project is self-contained: the generated web bundle is committed in
  // app/src/main/assets/www. Without the desktop sources next to it (e.g. a repo that only
  // contains proudvocab-android) that ready-made bundle is used as is.
  if (fs.existsSync(path.join(OUT, 'index.html')) && fs.existsSync(path.join(OUT, 'ext', 'background.js')) && !process.env.PV_REQUIRE_DESKTOP) {
    console.log(`desktop renderer not found at ${SRC}`);
    console.log('using the ready-made web bundle committed in app/src/main/assets/www (nothing regenerated)');
    console.log('\nOK - 0 patch points applied (bundle already generated and checked in)');
    process.exit(0);
  }
  console.error(`desktop renderer not found at ${SRC} and there is no committed bundle in ${OUT}`);
  process.exit(2);
}

/* ------------------------------------------------------------ fs helpers */
function copyDir(from, to, skip = () => false) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (skip(a)) continue;
    if (e.isDirectory()) copyDir(a, b, skip);
    else fs.copyFileSync(a, b);
  }
}
const read = (p) => fs.readFileSync(path.join(OUT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(OUT, p), s);

let patches = 0;
/** replace regex/string `find` in `file`, asserting exactly `count` matches */
function patch(file, find, repl, count = 1) {
  let s = read(file);
  const re = typeof find === 'string' ? new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g') : new RegExp(find.source, 'g');
  const n = (s.match(re) || []).length;
  if (n !== count) throw new Error(`PATCH FAILED  ${file}: expected ${count} match(es) of ${re}, found ${n}`);
  s = s.replace(re, repl);
  write(file, s);
  patches += n;
  console.log(`  patched ${file}  (${n}x)  ${String(re).slice(0, 70)}`);
}

/* --------------------------------------------------------------- 1. copy */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(SRC, 'ext'), path.join(OUT, 'ext'));
copyDir(path.join(SRC, 'player'), path.join(OUT, 'player'));
fs.copyFileSync(path.join(SRC, 'bg.html'), path.join(OUT, 'bg.html'));

/* ------------------------------------------------------------ 2. overlay */
for (const f of ['index.html', 'shell.css', 'shell.js', 'android-bridge.js', 'mobile-player.css']) {
  fs.copyFileSync(path.join(OVL, f), path.join(OUT, f));
}
copyDir(path.join(OVL, 'dict'), path.join(OUT, 'dict'));
fs.copyFileSync(path.join(OVL, 'chrome-shim.js'), path.join(OUT, 'ext', 'chrome-shim.js'));
fs.copyFileSync(path.join(OVL, 'panel-desktop.js'), path.join(OUT, 'ext', 'panel-desktop.js'));
fs.copyFileSync(path.join(OVL, 'ext-apiClient.js'), path.join(OUT, 'ext', 'sidepanel', 'apiClient.js'));
fs.writeFileSync(
  path.join(OUT, 'ext', 'desktop-panel.css'),
  fs.readFileSync(path.join(SRC, 'desktop', 'desktop-panel.css'), 'utf8') + '\n' + fs.readFileSync(path.join(OVL, 'panel-android.css'), 'utf8'),
);
console.log('copied desktop renderer + android overlay');

/* ---------------------------------------------------- 3. html injection */
const BRIDGE_TAG = '<script src="/android-bridge.js"></script>\n';
patch('bg.html', '<script>window.__PV_ROLE__ = "background";</script>', BRIDGE_TAG + '<script>window.__PV_ROLE__ = "background";</script>');
patch('player/player.html', '<script>window.__PV_ROLE__ = "player";</script>', BRIDGE_TAG + '<script>window.__PV_ROLE__ = "player";</script>');
patch('player/player.html', '</head>', '<link rel="stylesheet" href="/mobile-player.css">\n</head>');
patch('ext/sidepanel/panel.html', '<script>window.__PV_ROLE__ = "panel";</script>', BRIDGE_TAG + '  <script>window.__PV_ROLE__ = "panel";</script>');
patch('ext/sidepanel/panel.html', '<meta name="viewport" content="width=device-width, initial-scale=1.0">', '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">');

/* ------------------------------------------- 3b. English menu defaults */
console.log('setting English UI defaults (independent of the phone language)');
// Fix upstream key mismatches instead of leaving their Turkish HTML fallbacks.
const english = JSON.parse(read('ext/_locales/en/messages.json'));
for (const [key, original] of Object.entries({
  settings_prime_domain_title: 'settings_prime_domain',
  settings_prime_domain_default: 'settings_prime_domain_option_default',
  profile_sync_title: 'profile_sync_enable',
  modal_btn_close: 'premium_modal_close_btn',
})) {
  if (!english[original]?.message) throw new Error(`Missing English alias source: ${original}`);
  english[key] = { ...english[original] };
}
for (const [key, message] of Object.entries({
  settings_app_lang: 'App language',
  settings_lang_auto: 'English (default)',
  profile_login_google: 'Sign in with Google',
  sync_complete: 'Sync complete',
  premium_modal_message: 'All features are available in the Android app.',
  premium_smart_features_limit_desc: 'All smart features are available in the Android app.',
})) english[key] = { message };
write('ext/_locales/en/messages.json', JSON.stringify(english, null, 2));
write('ext/sidepanel/panel.html', renderEnglishPanel(read('ext/sidepanel/panel.html'), english));

// Every runtime default must agree with the shell, including after settings are
// cleared/restored. Do not change targetLang or the vocabulary learning language.
patch('ext/content/utils_common.js',
  /if\(!e\|\|"auto"===e\)\{const t=[^;]+;e=\["en","tr","de","fr","es"\]\.includes\(t\)\?t:"en"\}/,
  'if(!e||"auto"===e)e="en";');
patch('ext/content/utils_common.js', 'appLanguage:"auto"', 'appLanguage:"en"');
patch('ext/content/utils_common.js', 't?.appLanguage||"auto"', 't?.appLanguage||"en"');
patch('ext/content/utils_common.js', 'o("auto")', 'o("en")');
patch('ext/content/inject_common.js', 'e.appLanguage||"auto"', 'e.appLanguage||"en"');
patch('ext/sidepanel/panel_settings.js', 'appLanguage:"auto"', 'appLanguage:"en"');
patch('ext/sidepanel/panel_settings.js', 'const C=e.appLanguage||"tr"',
  'const C=e.appLanguage&&"auto"!==e.appLanguage?e.appLanguage:"en"');
patch('ext/sidepanel/panel_settings.js', 'e.settings.newValue?.appLanguage||"auto"',
  'e.settings.newValue?.appLanguage||"en"');

// The desktop player also sniffed navigator.language, ignoring the menu setting
// on Persian phones. In the Android app all UI follows the chosen menu language.
patch('player/player.js',
  `    const nav = String(navigator.language || '').toLowerCase();
    const ui = (BUS && BUS.i18n().uiLanguage) || 'en';
    LANG = nav.startsWith('fa') ? 'fa' : ui === 'tr' ? 'tr' : 'en';`,
  `    const ui = (BUS && BUS.i18n().uiLanguage) || 'en';
    LANG = STRINGS[ui] ? ui : 'en';`);
patch('player/player.js', '  async function start() {\n    applyI18n();',
  `  async function start() {
    if (BUS) window.top.document.addEventListener('pv-language-changed', applyI18n);
    applyI18n();`);

/* ------------------------------------------- 4. LICENSE / PREMIUM REMOVAL */
console.log('removing license / premium logic');
// (apiClient.js was replaced by a network-free stub in step 2)

// background: the "show upgrade modal" request is dropped
patch('ext/background.js', /return n&&n\.postMessage\(\{action:"show_premium_modal",title:e\.title,message:e\.message\}\),!1/, 'return!1');

// content engine: no 50-word cap, no "verified premium" requirement
patch('ext/content/inject_common.js', /verifiedIsPremium\s*=\s*!1/, 'verifiedIsPremium=!0');
patch('ext/content/inject_common.js', /savedWordsList=!!(\w)&&"FREE"!==(\w)&&verifiedIsPremium\?(\w):\3\.slice\(0,50\)/, 'savedWordsList=$3', 2);
patch('ext/content/inject_common.js', /savedWordsList="FREE"!==(\w)&&verifiedIsPremium\?(\w):\2\.slice\(0,50\)/, 'savedWordsList=$2', 4);
patch('ext/content/inject_common.js', /\("FREE"===(\w)\|\|!verifiedIsPremium\)&&(\w)\.length>=50/, '!1&&$2.length>=50', 2);
patch('ext/content/inject_common.js', /savedWordsList=(\w)\.slice\(0,50\),refreshVerifiedPremium\(\)/, 'savedWordsList=$1,refreshVerifiedPremium()');

// panel: settings (smart toggles, backup restore, games), archive, subtitles, games, modal
patch('ext/sidepanel/panel_settings.js', /(\w)=!!e\.googleSyncEmail&&\(!0===e\.isPremium\|\|"FREE"!==e\.licenseType&&"ACTIVE"===e\.licenseStatus\)/, '$1=!0');
patch('ext/sidepanel/panel_games.js', /(\w)=!!(\w)&&"FREE"!==(\w);document\.querySelectorAll\("\.game-card/, '$1=!0;document.querySelectorAll(".game-card');
patch('ext/sidepanel/panel_archive.js', /(\w)="FREE"!==(\w)\|\|(\w)<50/, '$1=!0');
patch('ext/sidepanel/panel_subtitles.js', /"FREE"===(\w)&&(\w)\.length>=50/, '!1&&$2.length>=50');
patch('ext/sidepanel/panel_utils.js', /function showPremiumModal\((\w),(\w)\)\{/, 'function showPremiumModal($1,$2){return;');

/* ------------------------------------------- 5. panel: no sniffed phone UI */
console.log('panel: keeping the full desktop UI on phones');
// The vendor panel ships a "standalone mobile" mode: when the User-Agent looks like a
// phone AND the frame is <= 600px wide, checkIsMobileUI() tags the body with
// .is-mobile-view, which hides the ENTIRE tab UI (Subtitles / Dictionary / Study /
// Settings) in favor of a settings-only screen, and also skips the background port,
// so no subtitles ever arrive. That mode is meant for the browser extension's
// standalone page; in this app the panel IS the app, so on every Android phone it
// booted into a blank panel. Force the detection off.
patch('ext/sidepanel/panel_core.js', 'function checkIsMobileUI(){', 'function checkIsMobileUI(){return!1;');

/* ------------------------------------------------- 6. player (touch etc.) */
console.log('adapting the player for touch / content URIs');
patch('player/player.js', String.raw`String(path).split(/[\\/]/).pop()`, 'bridge.nameOf(path)', 2);
patch('player/player.js', String.raw`String(p).split(/[\\/]/).pop()`, 'bridge.nameOf(p)', 1);
patch('player/player.js', 'await loadVideo(res.filePaths[0], { autoplay: true });', 'await openFiles(res.filePaths);');
patch('player/player.js', 'await loadSubtitleFile(res.filePaths[0], { activate: true });', 'for (const p of res.filePaths) await loadSubtitleFile(p, { activate: true });');
patch('player/player.js', /LANG === 'fa' \? 'نمایش در پوشه' : 'Show in folder', \(\) => \{\s*if \(state\.videoPath\) bridge\.invoke\('pv:show-in-folder', state\.videoPath\);\s*\}\);/,
  "LANG === 'fa' ? 'انتخاب فایل دیگر' : 'Pick another file', () => { pickVideo(); });");
patch('player/player.js', "stage.addEventListener('click', (e) => {",
  "stage.addEventListener('touchstart', () => { stage.__pvWasHidden = document.body.classList.contains('pv-hide-controls'); }, { passive: true });\n    stage.addEventListener('click', (e) => {");
patch('player/player.js', /if \(e\.detail === 2\) toggleFullscreen\(\);\s*else togglePlay\(\);/,
  "if (stage.__pvWasHidden) { stage.__pvWasHidden = false; showControls(); return; } /* first tap only reveals the controls */\n      if (e.detail === 2) toggleFullscreen();\n      else togglePlay();");
patch('player/player.js', 'through the pv-media:// protocol', 'through the local media server');
patch('player/player.js', 'Drop a video file here, or pick one from disk.', 'Pick a video from your phone.');
patch('player/player.js', 'فایل ویدیو را اینجا رها کنید یا از دیسک انتخاب کنید.', 'یک ویدیو از حافظهٔ گوشی انتخاب کنید.');

// The rate button only ever cycled FORWARD through 0.5x..2x (clamped at the top);
// the way back to 1x on desktop is the app's Playback menu, which the phone build
// has no replacement for - so once a speed was picked it could never be undone.
// Give the button a real picker with every rate (incl. 1x = normal).
patch('player/player.js', "cc_title: 'Subtitles',", "speed_title: 'Playback speed', cc_title: 'Subtitles',");
patch('player/player.js', "cc_title: 'زیرنویس", "speed_title: 'سرعت پخش', cc_title: 'زیرنویس");
patch('player/player.js', "cc_title: 'Altyazılar',", "speed_title: 'Oynatma hızı', cc_title: 'Altyazılar',");
patch('player/player.js', "$('btn-rate').addEventListener('click', () => cycleRate(1));",
  "$('btn-rate').addEventListener('click', (e) => { e.stopPropagation(); toggleRateMenu(); });");
patch('player/player.js',
  `  function cycleRate(dir) {
    let i = RATES.indexOf(state.rate);
    if (i < 0) i = RATES.indexOf(1);
    i = Math.max(0, Math.min(RATES.length - 1, i + dir));
    setRate(RATES[i]);
    toast(RATES[i] + '×', null, 900);
  }`,
  `  function cycleRate(dir) {
    let i = RATES.indexOf(state.rate);
    if (i < 0) i = RATES.indexOf(1);
    i = Math.max(0, Math.min(RATES.length - 1, i + dir));
    setRate(RATES[i]);
    toast(RATES[i] + '×', null, 900);
  }
  /* phone build: the desktop app resets the speed via its Playback menu; here the
     rate button opens a picker with every rate so 1x (normal) is always one tap away */
  function rateMenuEl() {
    let m = $('pv-rate-menu');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'pv-rate-menu';
    m.className = 'pv-popup pv-hidden';
    const head = document.createElement('div');
    head.className = 'pop-head';
    const title = document.createElement('span');
    title.textContent = t('speed_title');
    const x = document.createElement('button');
    x.className = 'pop-x';
    x.textContent = '✕';
    x.addEventListener('click', closePopups);
    head.appendChild(title);
    head.appendChild(x);
    const grid = document.createElement('div');
    grid.className = 'pop-body pv-rate-grid';
    for (const r of RATES) {
      const b = document.createElement('button');
      b.className = 'mini pv-rate-opt';
      b.dataset.rate = String(r);
      b.addEventListener('click', () => { setRate(r); closePopups(); toast(r + '×', null, 900); });
      grid.appendChild(b);
    }
    m.appendChild(head);
    m.appendChild(grid);
    $('pv-controls').appendChild(m);
    return m;
  }
  function toggleRateMenu() {
    const m = rateMenuEl();
    const open = m.classList.contains('pv-hidden');
    closePopups();
    if (!open) return;
    m.querySelectorAll('.pv-rate-opt').forEach((b) => {
      const on = parseFloat(b.dataset.rate) === state.rate;
      b.classList.toggle('active', on);
      b.textContent = b.dataset.rate + '×' + (on ? ' ✓' : '');
    });
    m.classList.remove('pv-hidden');
    showControls(true);
  }`);

/* -------------------------------------------------------- 7. self checks */
console.log('verifying output');
const problems = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|html|css|json)$/.test(e.name)) {
      const s = fs.readFileSync(p, 'utf8');
      const rel = path.relative(OUT, p);
      if (/app:\/\/bundle|pv-media:\/\//.test(s)) problems.push(`${rel}: desktop-only URL scheme still referenced`);
      if (/licenseServer/.test(s)) problems.push(`${rel}: references licenseServer`);
    }
  }
}
walk(OUT);
// the premium gates must be gone
const must = [
  ['ext/content/inject_common.js', /slice\(0,50\)/, 'saved-word cap'],
  ['ext/sidepanel/panel_settings.js', /googleSyncEmail&&\(!0===e\.isPremium/, 'settings lock'],
];
for (const [f, re, what] of must) if (re.test(read(f))) problems.push(`${f}: ${what} still present`);
if (/script\.google\.com|prime-vocab-mobile/.test(read('ext/sidepanel/apiClient.js'))) problems.push('apiClient.js still contains the license server URL');

if (problems.length) {
  console.error('\nPROBLEMS:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`\nOK - ${patches} patch points applied, output: ${path.relative(process.cwd(), OUT)}`);
