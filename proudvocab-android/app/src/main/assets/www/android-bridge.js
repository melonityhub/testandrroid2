/**
 * android-bridge.js - loaded FIRST in every frame (shell, player, panel, bg).
 *
 * Re-implements the Electron preload's `window.pvBridge` on top of the
 * @JavascriptInterface object `PVNative` that MainActivity injects, so the
 * ported desktop code (shell.js, player.js, chrome-shim.js ...) keeps its
 * original `bridge.invoke('pv:...')` calls.
 *
 *  - The top window owns the request table and receives the answers
 *    (window.__pvNativeResult / __pvNativeEmit are called by Java).
 *  - Sub-frames (player, panel, bg) simply re-use the top window's bridge.
 */
(function () {
  'use strict';
  if (window.pvBridge) return;

  var isTop = window.top === window;
  var VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.ogv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.ts', '.m2ts', '.3gp', '.3g2', '.vob', '.mts'];
  var SUB_EXT = ['.srt', '.vtt', '.ass', '.ssa', '.sub'];
  var NAME_MARK = '#pvn=';

  function extOf(name) {
    var s = String(name || '');
    var i = s.lastIndexOf('.');
    return i < 0 ? '' : s.slice(i).toLowerCase();
  }
  function nameOf(p) {
    var s = String(p || '');
    var i = s.indexOf(NAME_MARK);
    if (i >= 0) {
      try { return decodeURIComponent(s.slice(i + NAME_MARK.length)); } catch (e) { return s.slice(i + NAME_MARK.length); }
    }
    var last = s.split('?')[0].split('/').pop() || '';
    try { last = decodeURIComponent(last); } catch (e) { /* keep raw */ }
    return last.split(/[\/:]/).pop() || last;
  }
  function b64url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  var bridge;
  if (!isTop) {
    var tb = null;
    try { tb = window.top.pvBridge; } catch (e) { /* cross-origin: should never happen */ }
    if (tb) { window.pvBridge = tb; }
    bridge = tb;
  } else {
    var N = window.PVNative;
    var pending = new Map();
    var listeners = {};
    var seq = 0;
    var mediaBase = null;

    var invoke = function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      return new Promise(function (resolve, reject) {
        if (!N) { reject(new Error('Android bridge missing')); return; }
        var id = 'c' + (++seq);
        pending.set(id, { resolve: resolve, reject: reject });
        try { N.call(id, channel, JSON.stringify(args)); }
        catch (e) { pending.delete(id); reject(e); }
      });
    };

    window.__pvNativeResult = function (id, ok, payload) {
      var p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (!ok) { p.reject(new Error(payload || 'native error')); return; }
      try { p.resolve(payload === '' ? undefined : JSON.parse(payload)); }
      catch (e) { p.reject(e); }
    };
    window.__pvNativeEmit = function (channel, payload) {
      var cbs = listeners[channel];
      if (!cbs) return;
      var data;
      try { data = JSON.parse(payload); } catch (e) { data = payload; }
      cbs.slice().forEach(function (cb) { try { cb(data); } catch (e) { console.error(e); } });
    };

    bridge = {
      platform: 'android',
      versions: {},
      invoke: invoke,
      send: function (channel) {
        var args = Array.prototype.slice.call(arguments, 1);
        try { N && N.send(channel, JSON.stringify(args)); } catch (e) { /* ignore */ }
      },
      on: function (channel, cb) {
        (listeners[channel] = listeners[channel] || []).push(cb);
        return function () {
          var l = listeners[channel] || [];
          var i = l.indexOf(cb);
          if (i >= 0) l.splice(i, 1);
        };
      },
      /* no drag&drop of OS files on a phone */
      getPathForFile: function () { return ''; },
      nameOf: nameOf,
      isVideoFile: function (p) { return VIDEO_EXT.indexOf(extOf(nameOf(p))) >= 0; },
      isSubtitleFile: function (p) { return SUB_EXT.indexOf(extOf(nameOf(p))) >= 0; },
      mediaUrlFor: function (p) {
        if (!mediaBase) mediaBase = N.mediaBase();
        return mediaBase + b64url(String(p));
      },
      localIdFor: function (p) { return 'pv-local://' + b64url(String(p)); },
    };
    window.pvBridge = bridge;
  }
  if (!bridge) return;

  /* -------------------------------------------------------------------------
   * Downloads. WebView ignores <a download href="blob:...">, so every blob /
   * data download (backups, Anki / CSV exports) is routed to the system
   * "Save as" dialog (Storage Access Framework - no storage permission).
   * ----------------------------------------------------------------------- */
  var blobs = new Map();
  var origCreate = URL.createObjectURL ? URL.createObjectURL.bind(URL) : null;
  var origRevoke = URL.revokeObjectURL ? URL.revokeObjectURL.bind(URL) : null;
  if (origCreate) {
    URL.createObjectURL = function (obj) {
      var u = origCreate(obj);
      if (obj instanceof Blob) blobs.set(u, obj);
      return u;
    };
    URL.revokeObjectURL = function (u) {
      /* the page may revoke right after click(); we have already read the blob by then */
      setTimeout(function () { blobs.delete(u); }, 4000);
      return origRevoke(u);
    };
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(fr.error || new Error('read failed')); };
      fr.onload = function () {
        var s = String(fr.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.readAsDataURL(blob);
    });
  }

  function guessName(a) {
    var n = a.getAttribute('download');
    return n && n.trim() ? n.trim() : 'proudvocab-export.txt';
  }

  function saveAnchor(a) {
    var href = a.href || '';
    var name = guessName(a);
    var getBlob;
    if (/^blob:/i.test(href)) {
      var b = blobs.get(href);
      getBlob = b ? Promise.resolve(b) : fetch(href).then(function (r) { return r.blob(); });
    } else if (/^data:/i.test(href)) {
      getBlob = fetch(href).then(function (r) { return r.blob(); });
    } else {
      return false;
    }
    getBlob.then(function (blob) {
      return blobToBase64(blob).then(function (b64) {
        return bridge.invoke('pv:save-file', { name: name, mime: blob.type || 'application/octet-stream', base64: b64 });
      });
    }).then(function (res) {
      if (res && res.ok) toast('✓ ' + (res.name || name));
    }).catch(function (e) {
      console.error('[pv] save failed', e);
      toast('✗ Could not save the file');
    });
    return true;
  }

  function toast(text) {
    try {
      var d = document.createElement('div');
      d.textContent = text;
      d.setAttribute('style', 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:86%;padding:10px 16px;border-radius:999px;background:rgba(20,26,40,.96);color:#fff;font:600 13px system-ui,sans-serif;z-index:2147483647;box-shadow:0 6px 24px rgba(0,0,0,.5);pointer-events:none');
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { d.remove(); }, 2600);
    } catch (e) { /* ignore */ }
  }

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute('download') && saveAnchor(this)) return;
    return origClick.call(this);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && saveAnchor(a)) e.preventDefault();
  }, true);

  /* -------------------------------------------------------------------------
   * Player frame only: keep the screen on while the video plays and pause it
   * when the app goes to the background.
   * ----------------------------------------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    var v = document.getElementById('pv-video');
    if (!v) return;
    var awake = false;
    function setAwake(on) {
      if (on === awake) return;
      awake = on;
      bridge.invoke('pv:keep-awake', on).catch(function () {});
    }
    v.addEventListener('play', function () { setAwake(true); });
    v.addEventListener('playing', function () { setAwake(true); });
    v.addEventListener('pause', function () { setAwake(false); });
    v.addEventListener('ended', function () { setAwake(false); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && !v.paused) v.pause();
    });
    /* Word chips open their translation tooltip on `mouseenter`. Chromium
       normally emulates that for a tap; if it did not, fire it ourselves. */
    var sawEnter = false;
    document.addEventListener('mouseenter', function () { sawEnter = true; }, true);
    document.addEventListener('touchend', function (e) {
      var chip = e.target && e.target.closest ? e.target.closest('.primevocab-word-chip') : null;
      if (!chip) return;
      sawEnter = false;
      setTimeout(function () {
        if (!sawEnter) chip.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      }, 140);
    }, true);
    try {
      window.top.document.addEventListener('visibilitychange', function () {
        if (window.top.document.hidden && !v.paused) v.pause();
      });
    } catch (e) { /* ignore */ }
  });
})();
