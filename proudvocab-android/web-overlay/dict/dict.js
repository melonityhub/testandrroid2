/* Offline dictionary screen: import / remove the SQLite dictionary, search it
 * and show full entries. All database text is inserted with textContent. */
(function () {
  'use strict';

  var bridge = window.pvBridge;
  var BUS = null;
  try { BUS = window.top.__pvBus; } catch (e) { /* ignore */ }

  // Follow the app menu language, not the phone's locale.
  var isFa = /^fa/i.test(String(BUS ? BUS.i18n().uiLanguage : 'en'));
  var T = {
    title: ['Offline dictionary', 'دیکشنری آفلاین'],
    close: ['Close', 'بستن'],
    none_t: ['No dictionary installed', 'هنوز دیکشنری‌ای اضافه نشده'],
    none_d: ['Import a SQLite dictionary file that has the same structure as the FastDic / dictionaryproject database (english_words, english_details, persian_words …). It is copied into the app once and works fully offline. .zip / .gz archives are accepted too.',
      'یک فایل دیکشنری SQLite با ساختار دیتابیس پروژهٔ dictionaryproject (FastDic) را انتخاب کنید (جدول‌های english_words، english_details، persian_words و …). فایل یک‌بار داخل برنامه کپی می‌شود و کاملاً آفلاین کار می‌کند. فایل .zip یا .gz هم قبول می‌شود.'],
    import: ['Import dictionary file', 'افزودن فایل دیکشنری'],
    replace: ['Replace file', 'جایگزینی فایل'],
    remove: ['Remove', 'حذف'],
    installed: ['Dictionary ready', 'دیکشنری آماده است'],
    en_words: ['English words', 'لغت انگلیسی'],
    fa_words: ['Persian words', 'لغت فارسی'],
    size: ['Size', 'حجم'],
    use: ['Use it for word translations (EN ⇄ FA) before Google Translate', 'استفاده برای ترجمهٔ کلمات (EN ⇄ FA) پیش از گوگل ترنسلیت'],
    ph: ['Search a word…', 'جستجوی کلمه…'],
    no_results: ['No results', 'نتیجه‌ای پیدا نشد'],
    importing: ['Importing… keep the app open', 'در حال افزودن… برنامه را باز نگه دارید'],
    done: ['Dictionary imported ✓', 'دیکشنری اضافه شد ✓'],
    removed: ['Dictionary removed', 'دیکشنری حذف شد'],
    confirm_rm: ['Remove the offline dictionary from this phone?', 'دیکشنری آفلاین از این گوشی حذف شود؟'],
    e_not_sqlite: ['That file is not a SQLite database.', 'این فایل یک دیتابیس SQLite نیست.'],
    e_no_tables: ['The database has no english_words / english_details tables - it is not a FastDic-style dictionary.', 'این دیتابیس جدول‌های english_words / english_details را ندارد؛ ساختارش با FastDic یکی نیست.'],
    e_empty: ['The dictionary is empty.', 'دیکشنری خالی است.'],
    e_no_space: ['Not enough free storage on the phone.', 'فضای خالی گوشی کافی نیست.'],
    e_io: ['Could not read the file. Try again.', 'خواندن فایل ممکن نشد. دوباره تلاش کنید.'],
    pos: ['Parts of speech', 'نقش'],
    syn: ['Synonyms', 'مترادف'],
    ant: ['Antonyms', 'متضاد'],
    not_found: ['Word not found in the dictionary', 'این کلمه در دیکشنری پیدا نشد'],
  };
  function t(k) { var v = T[k]; return v ? v[isFa ? 1 : 0] : k; }

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var status = { installed: false };
  var busy = false;
  var searchSeq = 0;
  var timer = null;
  var inDetail = false;

  document.documentElement.lang = isFa ? 'fa' : 'en';
  document.documentElement.dir = isFa ? 'rtl' : 'ltr';
  $('title').textContent = t('title');
  $('back').setAttribute('aria-label', t('close'));
  $('q').placeholder = t('ph');

  function toast(msg, err) {
    var d = $('toast');
    d.textContent = msg;
    d.className = err ? 'err' : '';
    d.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { d.hidden = true; }, 3200);
  }

  function mb(n) { return (n / 1048576).toFixed(n > 10485760 ? 0 : 1) + ' MB'; }

  function renderStatus() {
    var box = $('status');
    box.textContent = '';
    if (!status.installed) {
      box.appendChild(el('h2', null, t('none_t')));
      box.appendChild(el('div', 'muted', t('none_d')));
    } else {
      box.appendChild(el('h2', null, '✓ ' + t('installed')));
      box.appendChild(el('div', 'muted', status.name || ''));
      var st = el('div', 'stat');
      [['en_words', status.englishWords || 0], ['fa_words', status.persianWords || 0]].forEach(function (p) {
        var s = el('span');
        s.appendChild(el('b', null, Number(p[1]).toLocaleString()));
        s.appendChild(document.createTextNode(' ' + t(p[0])));
        st.appendChild(s);
      });
      var sz = el('span');
      sz.appendChild(document.createTextNode(t('size') + ' '));
      sz.appendChild(el('b', null, mb(status.size || 0)));
      st.appendChild(sz);
      box.appendChild(st);

      var sw = el('label', 'switch');
      sw.appendChild(el('span', null, t('use')));
      var cb = el('input');
      cb.type = 'checkbox';
      cb.checked = !(BUS && BUS.config && BUS.config().dictEnabled === false);
      cb.addEventListener('change', function () {
        try { BUS.shell.saveDesktopCfg({ dictEnabled: cb.checked }); } catch (e) { /* ignore */ }
      });
      sw.appendChild(cb);
      box.appendChild(sw);
    }
    var prog = el('div', 'progress');
    prog.id = 'prog';
    prog.hidden = true;
    prog.appendChild(el('i'));
    box.appendChild(prog);

    var row = el('div', 'row');
    var imp = el('button', 'btn primary', status.installed ? t('replace') : t('import'));
    imp.disabled = busy;
    imp.addEventListener('click', doImport);
    row.appendChild(imp);
    if (status.installed) {
      var rm = el('button', 'btn danger', t('remove'));
      rm.disabled = busy;
      rm.addEventListener('click', doRemove);
      row.appendChild(rm);
    }
    box.appendChild(row);
    $('searchWrap').hidden = !status.installed;
  }

  function refresh() {
    return bridge.invoke('pv:dict-status').then(function (s) { status = s || { installed: false }; renderStatus(); });
  }

  function doImport() {
    if (busy) return;
    busy = true;
    renderStatus();
    var prog = $('prog');
    prog.hidden = false;
    prog.firstChild.style.width = '4%';
    toast(t('importing'));
    bridge.invoke('pv:dict-pick').then(function (res) {
      busy = false;
      if (res && res.ok) {
        status = res.status || status;
        toast(t('done'));
        try { BUS.shell.refreshDictStatus(); } catch (e) { /* ignore */ }
      } else if (res && res.error && res.error !== 'canceled') {
        toast(t('e_' + res.error) !== 'e_' + res.error ? t('e_' + res.error) : t('e_io'), true);
      }
      return refresh();
    }).catch(function (e) {
      busy = false;
      toast(String(e && e.message || e), true);
      renderStatus();
    });
  }

  function doRemove() {
    if (!window.confirm(t('confirm_rm'))) return;
    bridge.invoke('pv:dict-remove').then(function (s) {
      status = s || { installed: false };
      renderStatus();
      $('results').textContent = '';
      $('q').value = '';
      showList();
      toast(t('removed'));
      try { BUS.shell.refreshDictStatus(); } catch (e) { /* ignore */ }
    });
  }

  bridge.on('pv:dict-progress', function (p) {
    var prog = $('prog');
    if (!prog || !p) return;
    prog.hidden = false;
    var pct = p.total > 0 ? Math.min(99, Math.round(p.done * 100 / p.total)) : 50;
    prog.firstChild.style.width = pct + '%';
  });

  /* ------------------------------------------------------------ search */
  function showList() {
    inDetail = false;
    $('detail').hidden = true;
    $('status').hidden = false;
    $('searchWrap').hidden = !status.installed;
  }

  function runSearch() {
    var q = $('q').value.trim();
    var ul = $('results');
    if (!q) { ul.textContent = ''; return; }
    var seq = ++searchSeq;
    bridge.invoke('pv:dict-search', q, 40).then(function (res) {
      if (seq !== searchSeq) return;
      ul.textContent = '';
      var items = (res && res.items) || [];
      if (!items.length) { ul.appendChild(el('li', 'empty', t('no_results'))); return; }
      items.forEach(function (it) {
        var li = el('li');
        li.appendChild(el('span', 'w', it.word));
        li.appendChild(el('span', 'm', it.meaning || ''));
        li.addEventListener('click', function () { showDetail(it.word); });
        ul.appendChild(li);
      });
    });
  }

  $('q').addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(runSearch, 150); });
  $('q').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runSearch(); $('q').blur(); } });

  /* ------------------------------------------------------------ detail */
  function showDetail(word) {
    bridge.invoke('pv:dict-detail', word).then(function (d) {
      var box = $('detail');
      box.textContent = '';
      if (!d || !d.found) {
        box.appendChild(el('div', 'empty', t('not_found')));
      } else if (d.lang === 'English') {
        renderEnglish(box, d);
      } else {
        renderPersian(box, d);
      }
      inDetail = true;
      $('status').hidden = true;
      $('searchWrap').hidden = true;
      box.hidden = false;
      $('main').scrollTop = 0;
    });
  }

  function renderEnglish(box, d) {
    box.appendChild(el('h2', null, d.word));
    var forms = [];
    var f = d.forms || {};
    ['plural', 'simplePast', 'pastParticiple', 'presentParticiple', 'thirdPerson', 'comparative', 'superlative', 'infinitive'].forEach(function (k) { if (f[k]) forms.push(f[k]); });
    if (forms.length) box.appendChild(el('div', 'forms', forms.join(' · ')));
    (d.meanings || []).forEach(function (m) {
      var wrap = el('div', 'meaning');
      var chips = el('div', 'chips');
      (m.pos || []).forEach(function (p) { chips.appendChild(el('span', 'chip', isFa ? (p.fa || p.en) : (p.en || p.fa))); });
      if (m.cefr) chips.appendChild(el('span', 'chip cefr', m.cefr));
      (m.categories || []).forEach(function (c) { chips.appendChild(el('span', 'chip', c)); });
      if (chips.childNodes.length) wrap.appendChild(chips);
      wrap.appendChild(el('div', 'mt', m.meaning));
      (m.sentences || []).forEach(function (s) {
        var ex = el('div', 'ex');
        ex.appendChild(el('span', 'en', s.en));
        if (s.fa) ex.appendChild(el('span', 'fa', s.fa));
        wrap.appendChild(ex);
      });
      box.appendChild(wrap);
    });
    (d.synAnt || []).forEach(function (s) {
      if (!s.synonyms && !s.antonyms) return;
      var sa = el('div', 'sa');
      if (s.synonyms) { sa.appendChild(el('b', null, t('syn') + ': ')); sa.appendChild(document.createTextNode(s.synonyms)); }
      if (s.antonyms) { sa.appendChild(document.createElement('br')); sa.appendChild(el('b', null, t('ant') + ': ')); sa.appendChild(document.createTextNode(s.antonyms)); }
      box.appendChild(sa);
    });
  }

  function renderPersian(box, d) {
    box.appendChild(el('h2', null, d.word));
    (d.details || []).forEach(function (m) {
      var wrap = el('div', 'meaning');
      var chips = el('div', 'chips');
      (m.pos || []).forEach(function (p) { chips.appendChild(el('span', 'chip', isFa ? (p.fa || p.en) : (p.en || p.fa))); });
      if (m.phonetic) chips.appendChild(el('span', 'chip', m.phonetic));
      if (chips.childNodes.length) wrap.appendChild(chips);
      wrap.appendChild(el('div', 'mt', m.meaning));
      if (m.persianMeaning) wrap.appendChild(el('div', 'muted', m.persianMeaning));
      (m.sentences || []).forEach(function (s) {
        var ex = el('div', 'ex');
        ex.appendChild(el('span', 'en', s.en));
        if (s.fa) ex.appendChild(el('span', 'fa', s.fa));
        wrap.appendChild(ex);
      });
      box.appendChild(wrap);
    });
    var sa = (d.synAnt || []).filter(Boolean);
    if (sa.length) box.appendChild(el('div', 'sa', sa.join(' · ')));
  }

  /* --------------------------------------------------------- navigation */
  $('back').addEventListener('click', function () {
    if (inDetail) { showList(); return; }
    try { window.top.__pvOnBack(); } catch (e) { /* ignore */ }
  });
  window.__pvDictBack = function () {
    if (inDetail) { showList(); return true; }
    return false;
  };
  window.__pvDictOpen = function (word) {
    refresh().then(function () {
      if (word && status.installed) { $('q').value = word; showDetail(word); }
    });
  };

  renderStatus();
  refresh();
})();
