/* End-to-end test of the generated web layer inside a REAL Chromium (Electron)
 * with the Android bridge faked by fake-native.cjs.
 *   xvfb-run -a electron --no-sandbox scripts/e2e/run.cjs <fixturesDir> <sample.sqlite>
 */
const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..', '..');
const WWW = path.join(ROOT, 'app', 'src', 'main', 'assets', 'www');
const FIX = path.resolve(process.argv[process.argv.length - 2]);
const SAMPLE = path.resolve(process.argv[process.argv.length - 1]);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-e2e-'));
const TOKEN = 'e2etoken';
const SHOTS = process.env.PV_SHOTS || path.join(os.tmpdir(), 'pv-shots');
fs.mkdirSync(SHOTS, { recursive: true });

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('no-sandbox');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok || !extra ? '' : '  -> ' + extra)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* same contract as LocalServer.java: assets + /pvmedia/<token>/<b64> with Range */
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent(req.url.split('?')[0]);
      if (u.startsWith('/pvmedia/')) {
        const [, , tok, b] = u.split('/');
        if (tok !== TOKEN) { res.writeHead(403); return res.end(); }
        const p = Buffer.from(b.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        const name = decodeURIComponent(p.slice(p.indexOf('#pvn=') + 5));
        const f = path.join(FIX, name);
        if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
        const total = fs.statSync(f).size;
        const type = name.endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4';
        const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
        if (m) {
          let s = m[1] ? +m[1] : Math.max(0, total - +m[2]);
          let e = m[1] && m[2] ? Math.min(+m[2], total - 1) : total - 1;
          res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${s}-${e}/${total}`, 'Content-Length': e - s + 1 });
          return fs.createReadStream(f, { start: s, end: e }).pipe(res);
        }
        res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': total });
        return fs.createReadStream(f).pipe(res);
      }
      const rel = u === '/' ? 'index.html' : u.slice(1);
      const f = path.join(WWW, rel);
      if (rel.includes('..') || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': (MIME[path.extname(f)] || 'application/octet-stream') + (/(html|js|css|json)$/.test(f) ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

app.whenReady().then(async () => {
  const srv = await startServer();
  const port = srv.address().port;
  const origin = `http://127.0.0.1:${port}`;
  process.env.PV_E2E_CFG = JSON.stringify({
    fixtures: FIX, data: DATA, sampleDb: SAMPLE,
    dictionaryJava: path.join(ROOT, 'app/src/main/java/app/proudvocab/android/Dictionary.java'),
    mediaBase: `${origin}/pvmedia/${TOKEN}/`,
  });

  const win = new BrowserWindow({
    width: 393, height: 780, useContentSize: true, show: true,
    webPreferences: { preload: path.join(__dirname, 'fake-native.cjs'), contextIsolation: false, sandbox: false, nodeIntegration: false, backgroundThrottling: false },
  });
  /* Emulate a real Android phone: the window is already phone-sized (393x780), but
     the vendor panel code also sniffs the User-Agent before switching to its
     "mobile view". Electron's default UA doesn't match, which is how the
     blank-panel-on-Android bug slipped past this test - so force a WebView UA. */
  win.webContents.setUserAgent(
    'Mozilla/5.0 (Linux; Android 13; POCO X3 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.122 Mobile Safari/537.36'
  );

  const errors = [];
  win.webContents.on('console-message', (ev, level, message, line, source) => {
    const msg = ev && ev.message !== undefined ? ev.message : message;
    const lvl = ev && ev.level !== undefined ? ev.level : level;
    const src = ev && ev.sourceId !== undefined ? ev.sourceId : source;
    if (lvl === 'error' || lvl === 3) errors.push(`${msg}  [${String(src).replace(origin, '')}]`);
  });
  const ev = (js) => win.webContents.executeJavaScript(js, true);
  const waitFor = async (js, ms = 15000, step = 100) => { const t0 = Date.now(); for (;;) { let v; try { v = await ev(js); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(step); } };
  const shot = async (n) => { const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(SHOTS, n + '.png'), img.toPNG()); };
  const P = `document.getElementById('player-frame').contentWindow`;
  const PN = `document.getElementById('panel-frame').contentWindow`;

  try {
    await win.loadURL(origin + '/index.html');

    /* ------------------------------------------------------------ boot */
    console.log('\n[boot]');
    check('all 3 frames (background, player, panel) become ready',
      await waitFor(`window.__pvBus && __pvBus.debugInfo().frames.length===3 && __pvBus.debugInfo().frames.every(f=>f.ready)`, 20000));
    check('boot splash removed', await waitFor(`!document.getElementById('boot')`, 8000));
    check('chrome.* shim running in the player frame', await ev(`!!${P}.chrome && !!${P}.PrimeVocabCommon`));
    check('i18n bundle loaded', await ev(`Object.keys(__pvBus.i18n().messages).length>100`));

    /* the vendor panel sniffs UA + width and on a "phone" hides the ENTIRE tab UI
       (Subtitles / Dictionary / Study / Settings) behind a settings-only screen;
       here the panel IS the app, so it must always render the full UI */
    console.log('\n[android phone detection]');
    check('Android UA does NOT blank the panel (no sniffed mobile-view)',
      await ev(`!${PN}.document.body.classList.contains('is-mobile-view') && !${PN}.document.body.classList.contains('is-mobile-ui')`));
    check('the tab bar (Subtitles / Dictionary / Study) is rendered and visible',
      await ev(`(()=>{const w=${PN};return ['tab-subtitle','tab-archive','tab-review'].every(id=>{const e=w.document.getElementById(id);if(!e)return!1;const s=w.getComputedStyle(e),p=w.getComputedStyle(e.parentElement);return s.display!=='none'&&s.visibility!=='hidden'&&p.display!=='none'})})()`));
    check('panel header + content not hidden by the phone-mode CSS',
      await ev(`(()=>{const w=${PN},d=w.document;const h=d.querySelector('.header'),p=d.querySelector('.panel');return (!h||w.getComputedStyle(h).display!=='none')&&(!p||w.getComputedStyle(p).display!=='none')})()`));
    check('panel connected to the background port (subtitle updates can arrive)',
      await waitFor(`!!${PN}.eval('port')`, 8000));

    /* --------------------------------------------------------- premium */
    console.log('\n[license / premium removal]');
    check('store seeded with an unlimited plan', await ev(`(()=>{const l=__pvBus.shell.store.local;return l.isPremium===true&&l.licenseType==='LIFETIME'&&l.licenseStatus==='ACTIVE'})()`));
    check('PV_ApiClient.isPremiumVerified() === true', await ev(`${PN}.PV_ApiClient.isPremiumVerified()`));
    check('PV_ApiClient.checkLicense() answers locally', await ev(`${PN}.PV_ApiClient.checkLicense().then(r=>r.success&&r.data.licenseType==='LIFETIME')`));
    await ev(`${PN}.chrome.storage.local.set({isPremium:false,licenseType:'FREE',licenseStatus:'FREE_USER'})`);
    await sleep(200);
    check('writing a FREE plan is coerced back to unlimited', await ev(`(()=>{const l=__pvBus.shell.store.local;return l.isPremium===true&&l.licenseType==='LIFETIME'})()`));

    /* ---------------------------------------------------- open video + srt */
    console.log('\n[video + subtitles]');
    await ev(`${P}.__pvDesktop.pickVideo()`);
    check('video element has a duration (range streaming works)', await waitFor(`${P}.document.getElementById('pv-video').duration>5`, 15000));
    check('now-playing shows the file name', await waitFor(`document.getElementById('now-playing-text').textContent.includes('clip')`, 5000));
    check('subtitle track loaded from the same selection', await waitFor(`${P}.document.querySelectorAll('.tr-item').length>=1 || ${P}.document.getElementById('pv-subtitle-overlay')||${P}.document.getElementById('primevocab-subtitle-overlay')`, 8000));
    await ev(`(()=>{const v=${P}.document.getElementById('pv-video');v.currentTime=2.4;return v.play().catch(()=>0)})()`);
    check('video really plays (currentTime advances)', await waitFor(`${P}.document.getElementById('pv-video').currentTime>2.6`, 8000));
    check('keep-screen-on requested while playing', await waitFor(`window.__e2e.log.awake.includes(true)`, 3000));
    await ev(`${P}.document.getElementById('pv-video').pause()`);
    await ev(`${P}.document.getElementById('pv-video').currentTime=2.5`);
    const chips = await waitFor(`${P}.document.querySelectorAll('#primevocab-subtitle-overlay .primevocab-word-chip').length`, 10000);
    check('subtitle words rendered as tappable chips', chips > 3, 'chips=' + chips);
    if (process.env.PV_PROBE) console.log('PROBE:', JSON.stringify(await ev(process.env.PV_PROBE), null, 1));
    await shot('01-portrait-video');

    /* ------------------------------------------------------ playback speed */
    console.log('\n[playback speed picker]');
    await ev(`${P}.document.getElementById('btn-rate').click()`);
    check('tapping the rate button opens the speed menu',
      await waitFor(`(()=>{const m=${P}.document.getElementById('pv-rate-menu');return m&&!m.classList.contains('pv-hidden')})()`, 4000));
    await ev(`[...${P}.document.querySelectorAll('#pv-rate-menu .pv-rate-opt')].find((b)=>b.dataset.rate==='1.5').click()`);
    check('choosing 1.5x speeds the video up',
      await waitFor(`Math.abs(${P}.document.getElementById('pv-video').playbackRate-1.5)<0.01`, 4000));
    await ev(`${P}.document.getElementById('btn-rate').click()`);
    await ev(`[...${P}.document.querySelectorAll('#pv-rate-menu .pv-rate-opt')].find((b)=>b.dataset.rate==='1').click()`);
    check('...and 1x brings the speed back to normal',
      await waitFor(`Math.abs(${P}.document.getElementById('pv-video').playbackRate-1)<0.01`, 4000));
    check('rate button label is back to 1x',
      await ev(`${P}.document.getElementById('btn-rate').textContent.trim()==='1×'`));

    /* ----------------------------------------- word tap -> Google (no dict) */
    console.log('\n[translation: online]');
    await ev(`(()=>{const w=${P}.document.querySelectorAll('#primevocab-subtitle-overlay .primevocab-word-chip')[0];w.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false}));})()`);
    const tipOk = await waitFor(`(()=>{const t=${P}.document.querySelector('.primevocab-tooltip-wrapper');return t&&getComputedStyle(t).display!=='none'})()`, 6000);
    check('tapping a word opens the tooltip', tipOk);
    check('translation came through the Java fetch proxy (Google)', await waitFor(`window.__e2e.log.net.some(u=>/translate\\.googleapis\\.com/.test(u))`, 6000));
    check('NO request ever hit the license server', await ev(`!window.__e2e.log.net.some(u=>/script\\.google\\.com|prime-vocab-mobile/.test(u))`));

    /* ------------------------------------------------ saved-word cap lifted */
    console.log('\n[unlimited saved words]');
    await ev(`__pvBus.storageSet('local',{savedWords:Array.from({length:75},(_,i)=>({word:'word'+i,translation:'t'+i,cefr:'A1',timestamp:Date.now()+i}))})`);
    check('content engine keeps all 75 saved words (was capped at 50)', await waitFor(`${P}.eval('savedWordsList.length')===75`, 5000));

    /* -------------------------------------------------------------- panel */
    console.log('\n[side panel]');
    check('no premium lock overlays', await ev(`${PN}.document.querySelectorAll('.premium-lock-overlay').length===0`));
    check('upgrade / profile UI hidden', await ev(`['premium-modal','profile-btn','premium-welcome-modal'].every(id=>{const e=${PN}.document.getElementById(id);return !e||${PN}.getComputedStyle(e).display==='none'})`));
    await ev(`${PN}.openMenuDrawer && ${PN}.openMenuDrawer()`);
    await sleep(600);
    check('Settings drawer opens and its content is visible',
      await ev(`(()=>{const w=${PN},d=w.document;const o=d.getElementById('menuOverlay');return !!(o&&o.classList.contains('open')&&w.getComputedStyle(o).display!=='none'&&d.querySelectorAll('.settings-block, .settings-group, .settings-section').length)})()`));
    check('settings: nothing is marked premium-locked', await ev(`${PN}.document.querySelectorAll('.premium-locked').length===0`));
    check('settings: smart toggles are enabled', await ev(`(()=>{const ids=['auto-slowmo-toggle','auto-rewind-toggle','shadowing-toggle'];const els=ids.map(i=>${PN}.document.getElementById(i)).filter(Boolean);return els.length===0||els.every(e=>!e.disabled)})()`));
    await ev(`${PN}.closeMenuDrawer && ${PN}.closeMenuDrawer()`);

    /* ------------------------------------------------------------ download */
    console.log('\n[downloads -> Save-as dialog]');
    await ev(`(()=>{const w=${PN};const a=w.document.createElement('a');a.href=w.URL.createObjectURL(new w.Blob(['hello backup'],{type:'application/json'}));a.download='backup.json';w.document.body.appendChild(a);a.click();})()`);
    check('blob download routed to pv:save-file', await waitFor(`window.__e2e.log.saved.some(s=>s.name==='backup.json'&&s.bytes==='hello backup')`, 5000));

    /* ----------------------------------------------------------- fullscreen */
    console.log('\n[fullscreen]');
    await ev(`document.getElementById('btn-fullscreen').click()`);
    check('fullscreen hides the top bar + panel', await waitFor(`document.body.classList.contains('pv-fs') && getComputedStyle(document.getElementById('topbar')).display==='none'`, 3000));
    await shot('02-fullscreen');
    await ev(`document.getElementById('btn-fullscreen').click()`);
    check('leaving fullscreen restores the layout', await waitFor(`!document.body.classList.contains('pv-fs')`, 3000));

    /* ---------------------------------------------------------- dictionary */
    console.log('\n[offline dictionary]');
    check('no dictionary at first', await ev(`!document.body.classList.contains('has-dict')`));
    await ev(`__pvBus.shell.openDictionary()`);
    check('dictionary screen opens', await waitFor(`(()=>{const f=document.getElementById('dict-frame');return !document.getElementById('dict-overlay').hidden && f.contentDocument && f.contentDocument.querySelector('.btn.primary')})()`, 6000));
    await shot('03-dict-empty');
    const D = `document.getElementById('dict-frame').contentWindow`;
    await ev(`${D}.document.querySelector('.btn.primary').click()`);
    check('import finishes and status shows the dictionary', await waitFor(`${D}.document.getElementById('status').textContent.includes('sample.sqlite')`, 8000));
    check('shell flag has-dict set', await waitFor(`document.body.classList.contains('has-dict')`, 3000));
    await ev(`(()=>{const q=${D}.document.getElementById('q');q.value='propag';q.dispatchEvent(new Event('input'))})()`);
    check('search finds "propagate"', await waitFor(`${D}.document.querySelector('#results .w')&&${D}.document.querySelector('#results .w').textContent==='propagate'`, 5000));
    await shot('04-dict-search');
    await ev(`${D}.document.querySelector('#results li').click()`);
    check('entry detail renders meanings', await waitFor(`${D}.document.querySelectorAll('#detail .meaning').length>=1`, 5000));
    await shot('05-dict-detail');
    check('Back closes the detail first', await ev(`window.__pvOnBack()`) && await ev(`!${D}.document.getElementById('status').hidden`));
    check('Back closes the dictionary overlay', await ev(`window.__pvOnBack()`) && await ev(`document.getElementById('dict-overlay').hidden`));
    check('Back with nothing open is not handled (Android finishes)', (await ev(`window.__pvOnBack()`)) === false);

    console.log('\n[translation: offline dictionary first]');
    await ev(`__pvBus.storageSet('sync',{settings:Object.assign({},__pvBus.shell.store.sync.settings||{},{targetLang:'fa',sourceLang:'en'})})`);
    const dres = await ev(`__pvBus.runtimeSend('player',{action:'translate',word:'propagate',targetLang:'fa'})`);
    check('known word -> answered by the dictionary (Persian)', dres && dres.success && dres.source === 'offline-dictionary' && /[\u0600-\u06FF]/.test(dres.translation), JSON.stringify(dres));
    const before = await ev(`window.__e2e.log.net.length`);
    await ev(`__pvBus.runtimeSend('player',{action:'translate',word:'propagate',targetLang:'fa'})`);
    check('...without touching the network', (await ev(`window.__e2e.log.net.length`)) === before);
    const gres = await ev(`__pvBus.runtimeSend('player',{action:'translate',word:'zzzqqq',targetLang:'fa'})`);
    check('unknown word falls back to Google', gres && gres.success && gres.translation === 'GOOGLE-TRANSLATED', JSON.stringify(gres));
    const long = await ev(`__pvBus.runtimeSend('player',{action:'translate',word:'this is a long sentence that is not a word',targetLang:'fa'})`);
    check('sentences are never sent to the dictionary', long && long.translation === 'GOOGLE-TRANSLATED');
    await ev(`__pvBus.shell.saveDesktopCfg({dictEnabled:false})`);
    const off = await ev(`__pvBus.runtimeSend('player',{action:'translate',word:'propagate',targetLang:'fa'})`);
    check('"use dictionary" switch off -> Google', off && off.translation === 'GOOGLE-TRANSLATED');
    await ev(`__pvBus.shell.saveDesktopCfg({dictEnabled:true})`);
    await ev(`document.querySelector('#dict-overlay').hidden=true`);

    /* ------------------------------------------------------------- persist */
    console.log('\n[persistence]');
    await ev(`window.__pvFlush()`);
    await sleep(500);
    const saved = JSON.parse(fs.readFileSync(path.join(DATA, 'store.json'), 'utf8'));
    check('store.json holds the 75 saved words + unlimited plan', saved.local.savedWords.length === 75 && saved.local.licenseType === 'LIFETIME');

    /* ------------------------------------------------------- video: mkv too */
    console.log('\n[mkv file]');
    await ev(`(()=>{window.__e2e.nextDialog={canceled:false,filePaths:[window.__e2e.mk('clip.mkv')]};return ${P}.__pvDesktop.pickVideo()})()`);
    const mkv = await waitFor(`${P}.document.getElementById('pv-video').duration>5 && document.getElementById('now-playing-text').textContent.includes('clip.mkv')`, 12000);
    check('clip.mkv (H.264 in Matroska) loads', mkv);

    /* ----------------------------------------------------------- landscape */
    console.log('\n[layout]');
    await ev(`${P}.document.getElementById('pv-video').pause()`);
    win.setContentSize(851, 393);
    await sleep(700);
    check('landscape: video and panel are side by side', await ev(`(()=>{const s=document.getElementById('stage').getBoundingClientRect(),p=document.getElementById('panel-wrap').getBoundingClientRect();return p.left>=s.right-2&&s.height>300})()`));
    await shot('06-landscape');
    win.setContentSize(393, 780);
    await sleep(500);
    check('portrait: panel is below the video', await ev(`(()=>{const s=document.getElementById('stage').getBoundingClientRect(),p=document.getElementById('panel-wrap').getBoundingClientRect();return p.top>=s.bottom-2&&p.height>200})()`));
    await shot('07-portrait-final');
  } catch (e) {
    check('test run completed without a crash', false, String(e && e.stack || e));
  }

  /* ------------------------------------------------------- console errors */
  console.log('\n[console]');
  const uniq = [...new Set(errors)].filter((m) => !/Failed to load resource.*(fonts\.googleapis|404)/i.test(m));
  uniq.slice(0, 12).forEach((m) => console.log('  console.error: ' + m.slice(0, 220)));
  check('no uncaught exceptions in any frame', !uniq.some((m) => /Uncaught|TypeError|ReferenceError|SyntaxError/.test(m)), uniq.filter((m) => /Uncaught|TypeError|ReferenceError|SyntaxError/.test(m)).join(' | '));

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed` + (failed.length ? '\nFAILED: ' + failed.map((f) => f.name).join('; ') : ''));
  console.log('screenshots: ' + SHOTS);
  srv.close();
  app.exit(failed.length ? 1 : 0);
});
