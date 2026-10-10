/* apiClient.js - Android build.
 * The original file talked to a license server, verified signed license
 * tokens and could reset the app to a FREE plan. All of that is removed:
 * this stub has the same public surface (so existing callers keep working)
 * but never touches the network and always reports a full, unlimited plan. */
var PV_CONFIG = { apiUrl: '' };
var PV_LICENSE_PUBLIC_KEY_PEM = '';

globalThis.PV_ApiClient = (function () {
  var FULL = { isPremium: true, licenseType: 'LIFETIME', licenseStatus: 'ACTIVE', expirationDate: '' };

  function getOrCreateUserId() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(['userId'], function (r) {
        if (r && r.userId) { resolve(r.userId); return; }
        var id = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
          ? crypto.randomUUID()
          : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            var n = 16 * Math.random() | 0;
            return (c === 'x' ? n : (3 & n | 8)).toString(16);
          });
        chrome.storage.local.set({ userId: id }, function () { resolve(id); });
      });
    });
  }

  function full() { return Promise.resolve({ success: true, data: Object.assign({}, FULL) }); }

  return {
    getOrCreateUserId: getOrCreateUserId,
    registerUser: full,
    checkLicense: full,
    syncUsage: full,
    getEffectiveConfig: function () { return Promise.resolve(Object.assign({ isPremium: true, licenseToken: null }, FULL)); },
    verifyLicenseState: function () { return Promise.resolve(true); },
    enforceLicenseIntegrity: function () { return Promise.resolve(true); },
    isPremiumVerified: function () { return Promise.resolve(true); },
  };
})();
