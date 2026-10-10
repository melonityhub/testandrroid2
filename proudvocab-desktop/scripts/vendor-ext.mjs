#!/usr/bin/env node
/**
 * vendor-ext.mjs
 * ---------------------------------------------------------------------------
 * Copies the original ProudVocab browser-extension sources into
 * `src/renderer/ext/` and applies the *minimal* set of patches that are needed
 * to run the same engine inside a desktop app with local video + local SRT.
 *
 * Everything else (player, SRT engine, chrome.* shim, IPC bridge) is new code
 * that lives outside of `ext/` so that re-vendoring never destroys it.
 *
 * Usage:
 *   node scripts/vendor-ext.mjs [--src /path/to/proudvocab]
 *
 * If no --src is given the script looks for ./vendor-src and, when missing,
 * clones https://github.com/mohsenamiri/proudvocab into it.
 * ---------------------------------------------------------------------------
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const REPO = 'https://github.com/mohsenamiri/proudvocab.git';

const args = process.argv.slice(2);
let SRC = path.join(ROOT, 'vendor-src');
const srcIdx = args.indexOf('--src');
if (srcIdx !== -1 && args[srcIdx + 1]) SRC = path.resolve(args[srcIdx + 1]);

const OUT = path.join(ROOT, 'src', 'renderer', 'ext');

/* ------------------------------------------------------------------ helpers */
let patchCount = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error(`\n\x1b[31m✖ VENDOR FAILED: ${msg}\x1b[0m\n`);
    process.exit(1);
  }
}
function countOcc(hay, needle) {
  return hay.split(needle).length - 1;
}
/** Replace `needle` exactly `expected` times (default 1). Fails loudly otherwise. */
function patch(file, needle, replacement, expected = 1, label = '') {
  const p = path.join(OUT, file);
  let s = fs.readFileSync(p, 'utf8');
  const n = countOcc(s, needle);
  assert(n === expected, `${file}: expected ${expected} occurrence(s) of ${label || JSON.stringify(needle.slice(0, 60))} but found ${n}`);
  s = s.split(needle).join(replacement);
  fs.writeFileSync(p, s);
  patchCount++;
  console.log(`   ✎ ${file} :: ${label || needle.slice(0, 48) + '…'}`);
}
function patchRegex(file, re, replacement, expected, label) {
  const p = path.join(OUT, file);
  let s = fs.readFileSync(p, 'utf8');
  const n = (s.match(re) || []).length;
  assert(n === expected, `${file}: expected ${expected} match(es) of ${label} but found ${n}`);
  s = s.replace(re, replacement);
  fs.writeFileSync(p, s);
  patchCount++;
  console.log(`   ✎ ${file} :: ${label}`);
}
function copy(rel, destRel = rel) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, destRel);
  assert(fs.existsSync(from), `missing source file: ${rel}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  return to;
}
function copyDir(rel) {
  const from = path.join(SRC, rel);
  assert(fs.existsSync(from), `missing source dir: ${rel}`);
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const r = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) copyDir(r);
    else copy(r);
  }
}

/* ------------------------------------------------------------------- prepare */
if (!fs.existsSync(SRC)) {
  console.log(`• vendor-src not found – cloning ${REPO}`);
  execFileSync('git', ['clone', '--depth', '1', REPO, SRC], { stdio: 'inherit' });
}
assert(fs.existsSync(path.join(SRC, 'manifest.json')), `${SRC} does not look like the ProudVocab extension`);

console.log(`• source : ${SRC}`);
console.log(`• output : ${OUT}`);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------- copy: content */
console.log('\n[1/7] content scripts (engine)');
for (const f of [
  'content/utils_common.js',
  'content/phrasal_verbs.js',
  'content/idioms.js',
  'content/cefr_data.js',
  'content/inject.css',
  'content/inject_common.js',
]) copy(f);

/* ----------------------------------------------------------- copy: sidepanel */
console.log('\n[2/7] side panel (full UI)');
for (const f of [
  'sidepanel/panel.html',
  'sidepanel/panel.css',
  'sidepanel/apiClient.js',
  'sidepanel/panel_utils.js',
  'sidepanel/panel_subtitles.js',
  'sidepanel/panel_archive.js',
  'sidepanel/panel_review.js',
  'sidepanel/panel_games.js',
  'sidepanel/panel_settings.js',
  'sidepanel/panel_sync.js',
  'sidepanel/panel_core.js',
  'sidepanel/panel_onboarding.js',
]) copy(f);

/* ------------------------------------------------------------ copy: bg/data */
console.log('\n[3/7] background + data packs');
copy('background.js');
copyDir('langs');
copyDir('_locales');
copyDir('icons');

/* ------------------------------------------------------------------- patches */
console.log('\n[4/7] patches');

/*
 * (A) inject_common.js – teach the engine about a 4th platform: "local".
 * The extension maps PlayerAdapter.name -> settings key with a 3-way ternary in
 * 4 places. We extend each of them so `name:"Local"` reads/writes settings.local
 * (which falls back to the Prime defaults – identical values, different bucket).
 * NOTE: the comparison must accept the capitalised adapter name – matching only
 * "local" silently leaves the engine on the Prime bucket (dual subtitles, font
 * size, position … all read from the wrong place).
 */
patchRegex(
  'content/inject_common.js',
  /"YouTube"===(\w+)\?"youtube":"Netflix"===\1\?"netflix":"prime"/g,
  '"YouTube"===$1?"youtube":"Netflix"===$1?"netflix":"Local"===$1||"local"===$1?"local":"prime"',
  4,
  'platform key map (+local)'
);

/*
 * (B) panel_settings.js – the panel must know about the "local" bucket too,
 * otherwise getActivePlatform() returns "local" while saveSetting() only
 * initialises youtube/prime/netflix and would throw on `settings.local[x] = …`.
 */
patch('sidepanel/panel_settings.js',
  '"prime"===e?DEFAULT_PRIME_SETTINGS',
  '"prime"===e||"local"===e?DEFAULT_PRIME_SETTINGS', 1,
  'getDefaultPlatformSettings(local)');
patch('sidepanel/panel_settings.js',
  'return t.includes("youtube")?"youtube"',
  'return t.includes("local")?"local":t.includes("youtube")?"youtube"', 1,
  'getPlatformKey(local)');
patch('sidepanel/panel_settings.js',
  't.url.includes("youtube.com")||t.url.includes("youtu.be")?o="youtube"',
  't.url.startsWith("pv-local:")||t.url.startsWith("app:")?o="local":t.url.includes("youtube.com")||t.url.includes("youtu.be")?o="youtube"', 1,
  'detectAndSetPlatform(local)');
patch('sidepanel/panel_settings.js',
  '["youtube","prime","netflix"].forEach',
  '["youtube","prime","netflix","local"].forEach', 1,
  'premium-reset list (+local)');
patch('sidepanel/panel_settings.js',
  't("youtube"),t("prime"),t("netflix")',
  't("youtube"),t("prime"),t("netflix"),t("local")', 1,
  'loadSettings init (+local)');
patch('sidepanel/panel_settings.js',
  'n("youtube"),n("prime"),n("netflix")',
  'n("youtube"),n("prime"),n("netflix"),n("local")', 1,
  'saveSetting init (+local)');
patch('sidepanel/panel_settings.js',
  'youtube:{},prime:{},netflix:{}',
  'youtube:{},prime:{},netflix:{},local:{}', 1,
  'storage defaults (+local)');

/*
 * (C) panel.html – inject the desktop shim, a desktop-only stylesheet and the
 * small "panel-desktop.js" adapter; swap the 3 platform buttons for one
 * "Local video" button; add Persian (fa) to both language pickers.
 */
{
  const p = path.join(OUT, 'sidepanel/panel.html');
  let h = fs.readFileSync(p, 'utf8');

  // C1 – shim must be the very first script of the document.
  const headMark = '<link rel="stylesheet" href="panel.css">';
  assert(countOcc(h, headMark) === 1, 'panel.html: stylesheet anchor not found');
  h = h.replace(headMark,
`<script>window.__PV_ROLE__ = "panel";</script>
  <script src="../chrome-shim.js"></script>
  ${headMark}
  <link rel="stylesheet" href="../desktop-panel.css">`);

  // C2 – desktop adapter last, so it can override behaviour.
  assert(countOcc(h, '</body>') === 1, 'panel.html: </body> not found');
  h = h.replace('</body>', '  <script src="../panel-desktop.js"></script>\n</body>');

  // C3 – platform filter buttons -> a single "local" button.
  const startTok = '<button class="platform-filter-btn2 on active" data-platform="youtube"';
  const startIdx = h.indexOf(startTok);
  assert(startIdx > 0, 'panel.html: platform buttons not found');
  const netflixIdx = h.indexOf('data-platform="netflix"', startIdx);
  assert(netflixIdx > startIdx, 'panel.html: netflix platform button not found');
  const endIdx = h.indexOf('</button>', netflixIdx) + '</button>'.length;
  const localBtn = `<button class="platform-filter-btn2 on active" data-platform="local" data-val="lc" type="button">
                <span class="platform-ico">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v14H4z"/><path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/></svg>
                </span>
                <span data-i18n="platform_local">Local video</span>
              </button>`;
  h = h.slice(0, startIdx) + localBtn + h.slice(endIdx);

  // C4 – Persian as a *target* language (translation destination).
  const faOpt = (val, label, i18n) =>
    `<button type="button" class="material-select-opt" data-val="${val}"><span data-i18n="${i18n}">${label}</span> <svg class="check-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M4 12l5 5L20 6"/></svg></button>`;
  const targetMenu = '<div class="material-select-menu" id="targetLangMenu">';
  assert(countOcc(h, targetMenu) === 1, 'panel.html: targetLangMenu not found');
  h = h.replace(targetMenu, `${targetMenu}\n                ${faOpt('fa', 'فارسی', 'lang_fa')}`);

  const targetSel = '<select id="target-lang-select" style="display:none;">';
  assert(countOcc(h, targetSel) === 1, 'panel.html: target-lang-select not found');
  h = h.replace(targetSel, `${targetSel}\n                <option value="fa">فارسی</option>`);

  // C5 – Persian as a *source* language (an SRT that is already in Persian).
  const sourceMenu = '<div class="material-select-menu" id="sourceLangMenu">';
  assert(countOcc(h, sourceMenu) === 1, 'panel.html: sourceLangMenu not found');
  h = h.replace(sourceMenu, `${sourceMenu}\n                ${faOpt('fa', 'فارسی', 'lang_fa')}`);

  const sourceSel = '<select id="source-lang-select" style="display:none;">';
  assert(countOcc(h, sourceSel) === 1, 'panel.html: source-lang-select not found');
  h = h.replace(sourceSel, `${sourceSel}\n                <option value="fa">فارسی</option>`);

  fs.writeFileSync(p, h);
  patchCount += 5;
  console.log('   ✎ sidepanel/panel.html :: shim + local platform button + fa language');
}

/*
 * (D) _locales – add the strings the desktop build introduces and rename the
 * "Connected to Prime Video" status (the desktop app plays local files).
 */
{
  const STATUS = {
    en: 'Connected to local video',
    tr: 'Yerel videoya bağlı',
    de: 'Mit lokalem Video verbunden',
    fr: 'Connecté à la vidéo locale',
    es: 'Conectado al vídeo local',
  };
  const LANG_FA = { en: 'Persian', tr: 'Farsça', de: 'Persisch', fr: 'Persan', es: 'Persa' };
  const PLATFORM_LOCAL = { en: 'Local video', tr: 'Yerel video', de: 'Lokales Video', fr: 'Vidéo locale', es: 'Vídeo local' };
  for (const loc of ['en', 'tr', 'de', 'fr', 'es']) {
    const p = path.join(OUT, '_locales', loc, 'messages.json');
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.status_connected_prime) d.status_connected_prime.message = STATUS[loc];
    if (d.status_connected) d.status_connected.message = STATUS[loc];
    d.lang_fa = { message: LANG_FA[loc] };
    d.platform_local = { message: PLATFORM_LOCAL[loc] };
    fs.writeFileSync(p, JSON.stringify(d, null, 2));
    patchCount++;
  }
  console.log('   ✎ _locales/* :: +lang_fa, +platform_local, local-video status text');
}

/*
 * (E) langs/fa.json – the idiom / phrasal-verb explanation pack does not exist
 * for Persian upstream, so we seed it from the English pack. Without any pack
 * the idiom & phrasal tooltips would stay in Turkish.
 * Replace this file with a real Persian translation whenever you like.
 */
{
  const en = path.join(OUT, 'langs', 'en.json');
  const fa = path.join(OUT, 'langs', 'fa.json');
  if (!fs.existsSync(fa)) {
    fs.copyFileSync(en, fa);
    console.log('   ✎ langs/fa.json :: seeded from langs/en.json (translate me!)');
    patchCount++;
  }
}

/* --------------------------------------------- desktop-only files → ext/ */
console.log('\n[6/7] desktop adapters');
{
  const desk = path.join(ROOT, 'src', 'renderer', 'desktop');
  for (const f of ['chrome-shim.js', 'desktop-panel.css', 'panel-desktop.js']) {
    const from = path.join(desk, f);
    assert(fs.existsSync(from), `missing desktop file src/renderer/desktop/${f}`);
    fs.copyFileSync(from, path.join(OUT, f));
    console.log(`   + ext/${f}`);
  }
}

/* ------------------------------------------------------- integrity of output */
console.log('\n[7/7] integrity check');
const required = [
  'chrome-shim.js', 'desktop-panel.css', 'panel-desktop.js',
  'content/inject_common.js', 'content/utils_common.js', 'content/inject.css',
  'content/cefr_data.js', 'content/phrasal_verbs.js', 'content/idioms.js',
  'sidepanel/panel.html', 'sidepanel/panel.css', 'sidepanel/panel_core.js',
  'sidepanel/panel_settings.js', 'background.js', 'langs/en.json', 'langs/fa.json',
  '_locales/en/messages.json', 'icons/icon128.png',
];
for (const r of required) assert(fs.existsSync(path.join(OUT, r)), `missing output file ${r}`);
console.log(`   ✓ ${required.length} required files present`);

console.log(`\ndone – ${patchCount} patches applied.`);
console.log('Now run:  npm install && npm start');

