'use strict';
/**
 * smoke.js – end-to-end self test, run with `npm run smoke` (needs a display;
 * on Linux use `xvfb-run -a npm run smoke`).
 *
 * It boots the real app, loads the bundled sample video + SRT and verifies the
 * whole chain that the browser extension used to provide:
 *
 *   local file → pv-media:// → <video> → SRT cue → #pv-caption-host
 *     → engine MutationObserver → word chips / overlay
 *     → subtitle_update → background → panel transcript
 *     → click a chip → translate tooltip → save word → storage → archive
 *
 * Screenshots land in smoke-out/*.png and a machine readable report in
 * smoke-out/report.json.
 */
const path = require('node:path');
const fs = require('node:fs');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run({ app, createMainWindow }) {
  const outDir = app.isPackaged
    ? path.join(require('node:os').tmpdir(), 'proudvocab-smoke', 'out')
    : path.join(app.getAppPath(), 'smoke-out');
  fs.mkdirSync(outDir, { recursive: true });
  const logs = [];
  const steps = [];
  const shots = [];
  let win = null;

  const SAMPLE_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'samples')
    : path.join(app.getAppPath(), 'samples');
  const VIDEO = path.join(SAMPLE_DIR, 'sample-video.mp4');
  const SRT = path.join(SAMPLE_DIR, 'sample-video.srt');

  function log(level, message, source) {
    const line = { level, message: String(message).slice(0, 600), source: String(source || '').slice(-90) };
    logs.push(line);
    if (process.env.PV_SMOKE_VERBOSE === '1') console.log(`  [${level}] ${line.message} (${line.source})`);
  }

  async function step(name, fn) {
    const t0 = Date.now();
    try {
      const value = await fn();
      steps.push({ name, ok: true, ms: Date.now() - t0, value: value === undefined ? null : value });
      console.log(`  ✓ ${name} (${Date.now() - t0} ms)${value !== undefined && value !== null && typeof value !== 'object' ? ' → ' + value : ''}`);
      return { ok: true, value };
    } catch (e) {
      steps.push({ name, ok: false, ms: Date.now() - t0, error: String(e && e.message || e) });
      console.log(`  ✗ ${name} → ${e && e.message || e}`);
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  const js = async (code) => {
    if (!win || win.isDestroyed()) throw new Error('window gone');
    return win.webContents.executeJavaScript(code, true);
  };

  async function shot(name) {
    try {
      win.webContents.invalidate();
      await sleep(220);
      const img = await win.webContents.capturePage();
      if (!img || img.isEmpty()) { log('warn', 'empty capture: ' + name); return; }
      const file = path.join(outDir, name + '.png');
      fs.writeFileSync(file, img.toPNG());
      shots.push(file);
      console.log(`  📸 ${name}.png (${img.getSize().width}×${img.getSize().height})`);
    } catch (e) { log('warn', 'capture failed ' + name + ': ' + e.message); }
  }

  console.log('\n=== ProudVocab Desktop smoke test ===');
  console.log('sample video :', fs.existsSync(VIDEO) ? VIDEO : 'MISSING');
  console.log('sample srt   :', fs.existsSync(SRT) ? SRT : 'MISSING');

  win = createMainWindow();
  const wc = win.webContents;

  wc.on('console-message', (...args) => {
    let level; let message; let sourceId;
    if (args.length >= 3 && typeof args[1] === 'number') { level = args[1]; message = args[2]; sourceId = args[4]; }
    else { const e = args[0] || {}; level = e.level; message = e.message; sourceId = e.sourceId; }
    log(level, message, sourceId);
  });
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => log('error', `did-fail-load ${code} ${desc} ${url} main=${isMainFrame}`, url));
  wc.on('render-process-gone', (_e, d) => log('error', 'render-process-gone ' + JSON.stringify(d)));
  wc.on('unresponsive', () => log('error', 'webContents unresponsive'));
  wc.on('preload-error', (_e, p, err) => log('error', 'preload-error ' + p + ' ' + (err && err.message)));
  process.on('uncaughtException', (e) => log('error', 'main uncaught: ' + (e && e.stack || e)));

  await new Promise((resolve) => { wc.once('did-finish-load', resolve); setTimeout(resolve, 20000); });
  await sleep(1200);

  /* ------------------------------------------------------------ 1. shell */
  await step('shell: bus + frames registered', async () => {
    const info = await js('window.__pvBus ? window.__pvBus.debugInfo() : null');
    if (!info) throw new Error('window.__pvBus missing');
    const roles = info.frames.map((f) => f.role + (f.ready ? '✓' : '✗'));
    if (!info.frames.length) throw new Error('no frames registered');
    return { frames: roles, i18n: info.i18n, tab: info.tab.url };
  });

  await step('shell: all three frames ready', async () => {
    for (let i = 0; i < 60; i++) {
      const info = await js('window.__pvBus.debugInfo()');
      const ready = info.frames.filter((f) => f.ready).map((f) => f.role);
      if (['background', 'player', 'panel'].every((r) => ready.indexOf(r) >= 0)) return ready;
      await sleep(250);
    }
    const info = await js('window.__pvBus.debugInfo()');
    throw new Error('frames not ready: ' + JSON.stringify(info.frames));
  });

  await step('shim: chrome.storage round-trip (player frame)', async () => {
    return js(`new Promise((resolve, reject) => {
      const w = window.__pvBus.shell.playerFrame();
      w.chrome.storage.local.set({ __pvSmoke: { a: 1, b: [2, 3] } }, () => {
        w.chrome.storage.local.get({ __pvSmoke: null }, (res) => {
          res && res.__pvSmoke && res.__pvSmoke.b && res.__pvSmoke.b[1] === 3 ? resolve('ok') : reject(new Error('bad round trip: ' + JSON.stringify(res)));
        });
      });
      setTimeout(() => reject(new Error('storage timeout')), 4000);
    })`);
  });

  await step('shim: storage.onChanged reaches the panel frame', async () => {
    return js(`new Promise((resolve, reject) => {
      const p = window.__pvBus.shell.panelFrame();
      const w = window.__pvBus.shell.playerFrame();
      const t = setTimeout(() => reject(new Error('no change event')), 4000);
      p.chrome.storage.onChanged.addListener(function h(changes, area) {
        if (area === 'local' && changes.__pvSmokePing) {
          clearTimeout(t); p.chrome.storage.onChanged.removeListener(h); resolve('ok:' + changes.__pvSmokePing.newValue);
        }
      });
      w.chrome.storage.local.set({ __pvSmokePing: Date.now() });
    })`);
  });

  await step('background: CEFR lookup through the real background.js', async () => {
    const res = await js(`new Promise((resolve, reject) => {
      const w = window.__pvBus.shell.playerFrame();
      const t = setTimeout(() => reject(new Error('timeout')), 5000);
      w.chrome.runtime.sendMessage({ action: 'batch_lookup_cefr', words: ['hello', 'ubiquitous', 'meticulous', 'give'] }, (r) => {
        clearTimeout(t); resolve(r || null);
      });
    })`);
    if (!res || !res.cefrMap) throw new Error('no cefrMap: ' + JSON.stringify(res));
    if (!res.cefrMap.hello) throw new Error('CEFR_MAP did not load: ' + JSON.stringify(res));
    return res.cefrMap;
  });

  await step('background: port connected (panel ⇄ background)', async () => {
    const info = await js('window.__pvBus.debugInfo()');
    const alive = info.ports.filter((p) => p.alive);
    if (!alive.length) throw new Error('no live port – panel did not connect to background');
    return alive.map((p) => p.name + ' ' + p.a + '↔' + p.b);
  });

  /* ----------------------------------------------------------- 2. player */
  if (!fs.existsSync(VIDEO)) {
    console.log('  ! sample video missing – run `npm run sample` first');
  } else {
    await step('protocol: pv-media:// serves bytes with range support', async () => {
      const url = await js(`window.pvBridge.mediaUrlFor(${JSON.stringify(VIDEO)})`);
      const res = await js(`(async () => {
        const url = ${JSON.stringify('')} || window.pvBridge.mediaUrlFor(${JSON.stringify(VIDEO)});
        const r1 = await fetch(url);
        const b1 = await r1.arrayBuffer();
        const r2 = await fetch(url, { headers: { Range: 'bytes=0-99' } });
        const b2 = await r2.arrayBuffer();
        return { ok1: r1.ok, status1: r1.status, type: r1.headers.get('content-type'), size1: b1.byteLength,
                 status2: r2.status, size2: b2.byteLength, range: r2.headers.get('content-range') };
      })()`);
      if (!res.ok1 || !(res.size1 > 1000)) throw new Error('full fetch failed: ' + JSON.stringify(res));
      if (res.status2 !== 206 || res.size2 !== 100) throw new Error('range request failed: ' + JSON.stringify(res));
      return `${res.size1} bytes, 206 range ok (${res.type})`;
    });

    await step('player: load local mp4 over pv-media://', async () => {
      const ok = await js(`(async () => {
        const api = window.__pvBus.shell.playerFrame().__pvPlayer;
        await api.__test.loadVideo(${JSON.stringify(VIDEO)}, { autoplay: false, silentResume: true });
        for (let i = 0; i < 120; i++) { if (api.__test.ready()) return true; await new Promise(r => setTimeout(r, 100)); }
        return false;
      })()`);
      if (!ok) {
        const dbg = await js(`(() => {
          const v = window.__pvBus.shell.playerFrame().__pvPlayer.__test.video;
          return { readyState: v.readyState, networkState: v.networkState, currentSrc: v.currentSrc,
                   error: v.error ? { code: v.error.code, message: v.error.message } : null };
        })()`);
        throw new Error('video never reached loadedmetadata: ' + JSON.stringify(dbg));
      }
      const d = await js('window.__pvBus.shell.playerFrame().__pvPlayer.__test.video.duration');
      if (!(d > 10)) throw new Error('unexpected duration: ' + d);
      return 'duration=' + Math.round(d) + 's';
    });

    await shot('01-video-loaded');

    await step('player: load + parse the SRT', async () => {
      const n = await js(`(async () => {
        const api = window.__pvBus.shell.playerFrame().__pvPlayer;
        await api.__test.loadSubtitleFile(${JSON.stringify(SRT)}, { activate: true });
        return api.__test.cues();
      })()`);
      if (n !== 8) throw new Error('expected 8 cues, got ' + n);
      return n + ' cues';
    });

    await step('player: cue map published to the engine', async () => {
      const info = await js(`(() => {
        const w = window.__pvBus.shell.playerFrame();
        const subs = w.__primevocab_subtitles || {};
        const keys = Object.keys(subs);
        return { langs: keys, sizes: keys.map(k => subs[k] && subs[k].size) };
      })()`);
      if (!info.langs.length || !info.sizes.some((s) => s > 0)) throw new Error('no cue map: ' + JSON.stringify(info));
      return info.langs.join(',') + ' → ' + info.sizes.join(',');
    });

    await step('engine: caption → overlay → word chips', async () => {
      const res = await js(`(async () => {
        const w = window.__pvBus.shell.playerFrame();
        const api = w.__pvPlayer;
        api.__test.seekTo(2.2);
        for (let i = 0; i < 80; i++) {
          if (api.__test.chips() > 0) break;
          await new Promise(r => setTimeout(r, 100));
        }
        return {
          caption: api.__test.caption(),
          overlay: api.__test.overlayText().slice(0, 90),
          chips: api.__test.chips(),
          overlayExists: !!w.document.getElementById('primevocab-subtitle-overlay'),
        };
      })()`);
      if (!res.overlayExists) throw new Error('the engine never created #primevocab-subtitle-overlay');
      if (!res.caption) throw new Error('caption host is empty – SRT ticker did not run');
      if (!res.chips) throw new Error('no word chips rendered. overlay="' + res.overlay + '"');
      return `${res.chips} chips · "${res.overlay}…"`;
    });

    await shot('02-word-chips');

    await step('panel: transcript received the subtitle line', async () => {
      const probe = `(async () => {
        const p = window.__pvBus.shell.panelFrame().document;
        for (let i = 0; i < 60; i++) {
          const list = p.getElementById('transcript-list');
          if (list && list.children.length) return { rows: list.children.length, text: (list.textContent || '').trim().slice(0, 70) };
          await new Promise(r => setTimeout(r, 100));
        }
        return { rows: 0, text: '' };
      })()`;
      let res = await js(probe);
      if (res.rows) return res.rows + ' rows';

      /* nothing arrived – find out whether the panel side or the delivery side
         is at fault by posting a synthetic subtitle_update over the port */
      const diag = await js(`(() => {
        const BUS = window.__pvBus;
        const info = BUS.debugInfo();
        const port = info.ports.filter(p => p.alive)[0];
        if (!port) return { ports: info.ports, posted: false };
        BUS.portPost(port.id, 'background', { action: 'subtitle_update', text: 'SMOKE synthetic subtitle line.', time: 99.5, platform: 'Local' });
        return { ports: info.ports.map(p => p.name + ' ' + p.a + '<->' + p.b + (p.alive ? ' alive' : ' dead')), posted: true };
      })()`);
      res = await js(probe);
      throw new Error('panel transcript empty. synthetic port post ' + (diag.posted ? 'produced ' + res.rows + ' row(s)' : 'impossible (no port)') + ' · ports=' + JSON.stringify(diag.ports));
    });

    await shot('03-panel-transcript');

    await step('engine: clicking a word chip opens the tooltip', async () => {
      const res = await js(`(async () => {
        const w = window.__pvBus.shell.playerFrame();
        const d = w.document;
        const chip = d.querySelector('.primevocab-word-chip');
        if (!chip) throw new Error('no chip to click');
        const word = chip.textContent.trim();
        chip.dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: true }));
        chip.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
        chip.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
        let tip = null;
        for (let i = 0; i < 60; i++) {
          tip = d.querySelector('#primevocab-translation-tooltip, .primevocab-translation-tooltip');
          if (tip && tip.offsetParent !== null) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const txt = tip ? (tip.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        return { word, visible: !!(tip && tip.offsetParent !== null), text: txt.slice(0, 120) };
      })()`);
      if (!res.visible) throw new Error('tooltip did not appear for "' + res.word + '"');
      return res.word + ' → ' + (res.text || '(empty)');
    });

    await shot('04-word-tooltip');

    await step('engine: saving the word writes to chrome.storage.local', async () => {
      const res = await js(`(async () => {
        const w = window.__pvBus.shell.playerFrame();
        const d = w.document;
        /* the engine only wires the save button up once the translation has
           arrived, so wait for the tooltip to leave its "loading" state */
        let btn = null;
        for (let i = 0; i < 150; i++) {
          btn = d.querySelector('#primevocab-tooltip-save-btn') || d.querySelector('.primevocab-tooltip-save');
          if (btn && btn.onclick) break;
          await new Promise(r => setTimeout(r, 100));
        }
        if (!btn) return { skipped: 'no save button in tooltip' };
        if (!btn.onclick) return { skipped: 'save button has no handler (translation never arrived)' };
        btn.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
        for (let i = 0; i < 60; i++) {
          const st = window.__pvBus.debugInfo().store;
          if (st.savedWords > 0) return { savedWords: st.savedWords };
          await new Promise(r => setTimeout(r, 100));
        }
        return { savedWords: 0 };
      })()`);
      if (res.skipped) return res.skipped;
      if (!res.savedWords) throw new Error('word was not saved');
      return res.savedWords + ' word(s) in storage';
    });

    await step('panel: archive shows the saved word', async () => {
      const res = await js(`(async () => {
        const p = window.__pvBus.shell.panelFrame();
        const d = p.document;
        const tab = d.querySelector('[data-tab="archive"]');
        if (tab) tab.click();
        for (let i = 0; i < 50; i++) {
          const cards = d.querySelectorAll('.word-card');
          if (cards.length) return { cards: cards.length, first: (cards[0].textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60) };
          await new Promise(r => setTimeout(r, 100));
        }
        const onb = d.querySelector('.onboarding-overlay, #onboarding-overlay');
        return {
          cards: 0,
          activeTab: (d.querySelector('.nav-btn.active, .tab-btn.active, [data-tab].active') || {}).textContent,
          onboarding: onb ? { visible: onb.offsetParent !== null, display: getComputedStyle(onb).display } : null,
          archiveVisible: (() => { const a = d.getElementById('archive-container') || d.getElementById('tab-archive'); return a ? { display: getComputedStyle(a).display, html: a.innerHTML.length } : null; })(),
          anyWordCard: d.querySelectorAll('.word-card, .archive-word-card, .word-item').length,
          emptyMsg: (d.getElementById('empty-archive') || {}).textContent,
        };
      })()`);
      if (!res.cards) throw new Error('archive is empty: ' + JSON.stringify(res));
      return res.cards + ' card(s): ' + res.first;
    });

    await shot('05-archive');

    await step('engine: dual subtitle (Google Translate) – best effort', async () => {
      const res = await js(`(async () => {
        const w = window.__pvBus.shell.playerFrame();
        await new Promise((resolve) => {
          w.chrome.storage.sync.get({ settings: {} }, ({ settings }) => {
            const s = settings || {};
            s.local = s.local || {};
            s.local.dualSubtitles = true;
            s.local.sourceLang = s.local.sourceLang || 'en';
            s.local.targetLang = 'fa';
            s.dualSubtitles = true; s.targetLang = 'fa';
            s.timestamp = Date.now();
            w.chrome.storage.sync.set({ settings: s }, resolve);
          });
        });
        /* give the engine time to re-read settings, then move to a *new* cue so
           handleSubtitleChange() runs again and creates the dual-line element */
        await new Promise(r => setTimeout(r, 1200));
        const api = w.__pvPlayer;
        api.__test.seekTo(25.2);
        let txt = '';
        for (let i = 0; i < 120; i++) {
          const el = w.document.querySelector('.primevocab-subtitle-translation');
          txt = el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
          if (txt) break;
          await new Promise(r => setTimeout(r, 100));
        }
        /* diagnostics: does a direct translate message work from this frame? */
        const probe = await new Promise((resolve) => {
          const to = setTimeout(() => resolve('TIMEOUT'), 8000);
          try {
            w.chrome.runtime.sendMessage({ action: 'translate', word: 'It was raining cats and dogs.', sourceLang: 'en', targetLang: 'fa' }, (r) => {
              clearTimeout(to); resolve(r && r.success ? 'ok:' + String(r.translation).slice(0, 40) : 'fail:' + JSON.stringify(r).slice(0, 60));
            });
          } catch (e) { clearTimeout(to); resolve('throw:' + e.message); }
        });
        return {
          dual: txt.slice(0, 90), chips: api.__test.chips(), probe,
          engine: api.__test.getState().engine,
          hasDualEl: !!w.document.querySelector('.primevocab-subtitle-translation'),
          overlayOpacity: (w.document.getElementById('primevocab-subtitle-overlay') || {}).style ? w.document.getElementById('primevocab-subtitle-overlay').style.opacity : '?',
        };
      })()`);
      const eng = res.engine ? `dual=${res.engine.dualSubtitles} ${res.engine.sourceLang}→${res.engine.targetLang}` : 'engine settings not seen';
      if (!res.dual) return `no dual line · hasEl=${res.hasDualEl} · probe=${res.probe} · engine{${eng}} · chips=${res.chips}`;
      return `"${res.dual}" · engine{${eng}}`;
    });

    await shot('06-dual-subtitle');

    await step('player: cue navigation + speed + resume', async () => {
      return js(`(async () => {
        const w = window.__pvBus.shell.playerFrame();
        const api = w.__pvPlayer;
        api.__test.seekTo(0.1);
        api.menuAction('cue', 1);
        await new Promise(r => setTimeout(r, 300));
        const afterNext = api.video.currentTime;
        api.menuAction('rate', 1.5);
        const rate = api.video.playbackRate;
        api.menuAction('rate', 1);
        api.menuAction('cue', -1);
        await new Promise(r => setTimeout(r, 300));
        const afterPrev = api.video.currentTime;
        return { afterNext: Math.round(afterNext * 10) / 10, rate, afterPrev: Math.round(afterPrev * 10) / 10 };
      })()`);
    });

    await step('shell: panel toggle', async () => {
      const a = await js('window.__pvBus.config().panelVisible');
      await js('window.__pvBus.setPanelVisible(false)');
      await sleep(350);
      const b = await js('window.__pvBus.config().panelVisible');
      await js('window.__pvBus.setPanelVisible(true)');
      await sleep(350);
      if (a !== true || b !== false) throw new Error(`toggle failed ${a} → ${b}`);
      return 'visible → hidden → visible';
    });
  }

  /* ------------------------------------------------------------ 3. report */
  const errorLogs = logs.filter((l) => l.level >= 2 || /Uncaught|TypeError|ReferenceError|is not defined|Failed to load resource/i.test(l.message))
    .filter((l) => !/fonts\.googleapis|fonts\.gstatic|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|net::ERR/i.test(l.message));

  await shot('07-final');

  const report = {
    ts: new Date().toISOString(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    passed: steps.filter((s) => s.ok).length,
    failed: steps.filter((s) => !s.ok).length,
    steps,
    errors: errorLogs.slice(0, 40),
    logCount: logs.length,
    screenshots: shots.map((s) => path.basename(s)),
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, 'console.log'), logs.map((l) => `[${l.level}] ${l.message}  (${l.source})`).join('\n'));

  console.log(`\n--- ${report.passed} passed, ${report.failed} failed ---`);
  if (errorLogs.length) {
    console.log('\nsuspicious console output:');
    errorLogs.slice(0, 15).forEach((e) => console.log('  • ' + e.message.slice(0, 200)));
  }
  console.log('\nreport: ' + path.join(outDir, 'report.json'));

  await sleep(400);
  app.exit(report.failed ? 1 : 0);
}

module.exports = { run };
