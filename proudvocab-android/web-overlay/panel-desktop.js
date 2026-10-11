/**
 * panel-desktop.js (Android build) - last script of the side panel.
 *  - marks the body so panel-android.css can hide browser-only / paid-plan UI
 *  - hides the per-site (YouTube / Netflix / Prime) switches: this app plays local files only
 *  - explains where words are stored (Google-Drive sync is a browser-extension feature)
 */
(function () {
  'use strict';
  // Follow the app menu language, not the phone's locale.
  var isFa = /^fa/i.test(chrome.i18n.getUILanguage());

  function onReady(fn, tries) {
    tries = tries || 0;
    if (document.body) { fn(); return; }
    if (tries > 60) return;
    setTimeout(function () { onReady(fn, tries + 1); }, 50);
  }

  onReady(function () {
    document.body.classList.add('pv-desktop', 'pv-android');
    hideBrowserOnlyToggles();
    addSyncNote();
    setTimeout(function () {
      try { if (typeof detectAndSetPlatform === 'function') detectAndSetPlatform(); } catch (e) { /* ignore */ }
    }, 700);
  });

  function hideBrowserOnlyToggles() {
    ['enable-youtube-toggle', 'enable-netflix-toggle', 'enable-prime-toggle',
      'platform-toggle-youtube', 'platform-toggle-netflix', 'platform-toggle-prime'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var row = el.closest('.settings-block') || el.closest('.settings-group') || el.parentElement;
      if (row) row.classList.add('pv-desktop-hide');
    });
    document.querySelectorAll('[data-supported-platforms]').forEach(function (el) {
      var p = (el.getAttribute('data-supported-platforms') || '').split(',');
      if (p.indexOf('local') < 0 && p.indexOf('all') < 0) el.classList.add('pv-desktop-hide');
    });
  }

  function addSyncNote() {
    var anchor = document.getElementById('sync-google-btn') || document.getElementById('google-sync-btn') ||
      document.querySelector('[data-i18n="profile_sync_title"]');
    if (!anchor) return;
    var host = anchor.closest('.settings-block') || anchor.closest('.settings-card') || anchor.parentElement;
    if (!host || host.querySelector('.pv-android-note')) return;
    var n = document.createElement('div');
    n.className = 'pv-android-note';
    n.textContent = isFa
      ? 'همگام‌سازی گوگل‌درایو مخصوص افزونهٔ مرورگر است. در نسخهٔ اندروید کلمه‌ها به‌صورت خودکار در حافظهٔ خود برنامه ذخیره می‌شوند؛ برای بکاپ از بخش آرشیو خروجی JSON/Anki بگیرید.'
      : 'Google-Drive sync is a browser-extension feature. On Android your words are saved automatically inside the app; use the Archive tab to export a JSON / Anki backup.';
    host.appendChild(n);
  }
})();
