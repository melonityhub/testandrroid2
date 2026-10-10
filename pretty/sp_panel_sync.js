const GD_SYNC_FILE_NAME = "primevocab_sync.json",
    SYNC_DEFAULT_SHORTCUTS = "undefined" != typeof DEFAULT_SHORTCUTS ? DEFAULT_SHORTCUTS : {
        navLeft: "Numpad4",
        navRight: "Numpad6",
        navUp: "Numpad8",
        navDown: "Numpad2",
        navSave: "Numpad5",
        navCancel: "Numpad0"
    };

function getGoogleAuthToken(e = !1) {
    let t = !1;
    try {
        t = "undefined" != typeof navigator && navigator.userAgent.toLowerCase().includes("firefox")
    } catch (e) {
        t = !1
    }
    const o = t ? "firefox_sync_token" : "chrome_sync_token",
        a = t ? "firefox_sync_token_expires" : "chrome_sync_token_expires";
    if (!e) return new Promise((e, t) => {
        chrome.storage.local.get([o, a, "google_refresh_token", "googleSyncEmail"], async n => {
            if (!n.googleSyncEmail) return void t(new Error("USER_LOGGED_OUT"));
            if (n[o] && n[a] && n[a] > Date.now()) e(n[o]);
            else {
                if (n.google_refresh_token) try {
                    const t = await fetch("https://prime-vocab-mobile.vercel.app/api/refresh.js", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            refresh_token: n.google_refresh_token
                        })
                    });
                    if (t.ok) {
                        const o = await t.json(),
                            a = o.access_token,
                            n = Date.now() + 1e3 * parseInt(o.expires_in || "3600", 10),
                            s = {
                                chrome_sync_token: a,
                                chrome_sync_token_expires: n,
                                firefox_sync_token: a,
                                firefox_sync_token_expires: n
                            };
                        return o.refresh_token && (s.google_refresh_token = o.refresh_token), void chrome.storage.local.set(s, () => {
                            e(a)
                        })
                    }
                } catch (e) {
                    console.warn("[PV-Sync] Silent refresh failed:", e.message)
                }
                t(new Error("No valid cached token, interactive login required"))
            }
        })
    });
    return new Promise((e, t) => {
        const o = "undefined" != typeof navigator && navigator.userAgent ? navigator.userAgent.toLowerCase() : "",
            a = (/android|iphone|ipad|ipod|mobile/i.test(o) || "ontouchstart" in window && window.innerWidth, "undefined" != typeof browser && browser.identity ? browser.identity : "undefined" != typeof chrome ? chrome.identity : null),
            n = a && "function" == typeof a.getRedirectURL ? a.getRedirectURL() : "https://prime-vocab-mobile.vercel.app/oauth_callback.html",
            s = encodeURIComponent("https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
        let r = "";
        "undefined" != typeof chrome && chrome.runtime && "function" == typeof chrome.runtime.getURL && (r = chrome.runtime.getURL("sidepanel/panel.html"));
        const i = r ? "ext_" + btoa(encodeURIComponent(r)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "extension";
        const c = `https://accounts.google.com/o/oauth2/auth?client_id=123876704092-eo19nu69jggubqq158s7mkfi5o4n9rtu.apps.googleusercontent.com&redirect_uri=${encodeURIComponent(n)}&response_type=code&scope=${s}&access_type=offline&state=${encodeURIComponent(i)}&prompt=consent select_account`;
        if (a && "function" == typeof a.launchWebAuthFlow) try {
            a.launchWebAuthFlow({
                url: c,
                interactive: !0
            }, async o => {
                const a = "undefined" != typeof chrome && chrome.runtime ? chrome.runtime.lastError : null;
                if (!a && o) try {
                    const a = new URL(o).searchParams.get("code");
                    if (!a) return void t(new Error("Yetkilendirme kodu alınamadı"));
                    const s = await fetch("https://prime-vocab-mobile.vercel.app/api/token.js", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            code: a,
                            redirect_uri: n
                        })
                    });
                    if (!s.ok) throw new Error("Jeton değişimi başarısız oldu");
                    const r = await s.json(),
                        i = r.access_token,
                        c = r.refresh_token,
                        l = Date.now() + 1e3 * parseInt(r.expires_in || "3600", 10),
                        m = {
                            chrome_sync_token: i,
                            chrome_sync_token_expires: l,
                            firefox_sync_token: i,
                            firefox_sync_token_expires: l
                        };
                    c && (m.google_refresh_token = c), chrome.storage.local.set(m, () => {
                        e(i)
                    })
                } catch (e) {
                    t(e)
                } else {
                    console.warn("[PV-Sync] launchWebAuthFlow failed, trying tab fallback...", a?.message);
                    try {
                        "undefined" != typeof chrome && chrome.tabs && chrome.tabs.create ? chrome.tabs.create({
                            url: c
                        }) : window.open(c, "_blank"), t(new Error("INFO_OAUTH_TAB_OPENED"))
                    } catch (e) {
                        t(new Error("Google Giriş sayfası açılırken hata oluştu."))
                    }
                }
            })
        } catch (e) {
            console.warn("[PV-Sync] launchWebAuthFlow exception, trying tab fallback...", e);
            try {
                "undefined" != typeof chrome && chrome.tabs && chrome.tabs.create ? chrome.tabs.create({
                    url: c
                }) : window.open(c, "_blank"), t(new Error("INFO_OAUTH_TAB_OPENED"))
            } catch (e) {
                t(new Error("Google Giriş sayfası açılırken hata oluştu."))
            }
        } else try {
            "undefined" != typeof chrome && chrome.tabs && chrome.tabs.create ? chrome.tabs.create({
                url: c
            }) : "undefined" != typeof browser && browser.tabs && browser.tabs.create ? browser.tabs.create({
                url: c
            }) : window.open(c, "_blank"), t(new Error("INFO_OAUTH_TAB_OPENED"))
        } catch (e) {
            t(new Error("Google Giriş sayfası açılırken hata oluştu."))
        }
    })
}
async function connectGoogleAccount() {
    const e = await getGoogleAuthToken(!0),
        t = await getGoogleUserInfo(e);
    return await new Promise(e => chrome.storage.local.set({
        googleSyncEmail: t.email,
        googleSyncPicture: t.picture || ""
    }, e)), {
        email: t.email,
        picture: t.picture || ""
    }
}

function clearGoogleAuthToken() {
    let e = !1;
    try {
        e = "undefined" != typeof navigator && navigator.userAgent.toLowerCase().includes("firefox")
    } catch (t) {
        e = !1
    }
    return new Promise(t => {
        chrome.storage.local.get(["chrome_sync_token", "firefox_sync_token", "google_refresh_token"], o => {
            const a = o.chrome_sync_token || o.firefox_sync_token,
                n = o.google_refresh_token;
            chrome.storage.local.remove(["chrome_sync_token", "chrome_sync_token_expires", "firefox_sync_token", "firefox_sync_token_expires", "google_refresh_token"], () => {
                if (a && fetch(`https://accounts.google.com/o/oauth2/revoke?token=${a}`).catch(() => {}), n && fetch(`https://accounts.google.com/o/oauth2/revoke?token=${n}`).catch(() => {}), !e && "undefined" != typeof chrome && chrome.identity) try {
                    if ("function" == typeof chrome.identity.clearAllCachedAuthTokens) return void chrome.identity.clearAllCachedAuthTokens(() => {
                        chrome.runtime.lastError;
                        t(!0)
                    });
                    if ("function" == typeof chrome.identity.getAuthToken) return void chrome.identity.getAuthToken({
                        interactive: !1
                    }, e => {
                        chrome.runtime.lastError;
                        e && "function" == typeof chrome.identity.removeCachedAuthToken ? chrome.identity.removeCachedAuthToken({
                            token: e
                        }, () => {
                            chrome.runtime.lastError;
                            t(!0)
                        }) : t(!0)
                    })
                } catch (e) {
                    return void t(!0)
                }
                t(!0)
            })
        })
    })
}
async function getGoogleUserInfo(e) {
    if (!e) return null;
    try {
        const t = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: {
                Authorization: `Bearer ${e}`
            }
        });
        if (!t.ok) return null;
        const o = await t.json();
        return {
            email: o.email || "",
            picture: o.picture || ""
        }
    } catch (e) {
        return null
    }
}
async function findSyncFile(e) {
    if (!e) return null;
    try {
        const t = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${encodeURIComponent(`name = '${GD_SYNC_FILE_NAME}' and 'appDataFolder' in parents and trashed = false`)}&fields=files(id,name)`,
            o = await fetch(t, {
                headers: {
                    Authorization: `Bearer ${e}`
                }
            });
        if (!o.ok) return null;
        const a = await o.json();
        return a.files && a.files.length > 0 ? a.files[0].id : null
    } catch (e) {
        return null
    }
}
async function downloadSyncFile(e, t) {
    if (!e || !t) return null;
    try {
        const o = `https://www.googleapis.com/drive/v3/files/${t}?alt=media`,
            a = await fetch(o, {
                headers: {
                    Authorization: `Bearer ${e}`
                }
            });
        return a.ok ? await a.json() : null
    } catch (e) {
        return null
    }
}
async function uploadSyncFile(e, t, o) {
    const a = {
            name: GD_SYNC_FILE_NAME,
            parents: t ? void 0 : ["appDataFolder"]
        },
        n = "primevocab_boundary",
        s = `\r\n--${n}\r\n`,
        r = `\r\n--${n}--`,
        i = s + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(a) + s + "Content-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(o) + r,
        c = t ? `https://www.googleapis.com/upload/drive/v3/files/${t}?uploadType=multipart` : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
        l = t ? "PATCH" : "POST",
        m = await fetch(c, {
            method: l,
            headers: {
                Authorization: `Bearer ${e}`,
                "Content-Type": `multipart/related; boundary=${n}`
            },
            body: i
        });
    if (!m.ok) throw new Error("Failed to upload file");
    return await m.json()
}

function mergeSyncData(e, t, o = {}) {
    const a = e && "object" == typeof e ? e : {},
        n = t && "object" == typeof t ? t : {},
        s = o && "object" == typeof o ? o : {},
        r = {
            savedWords: [],
            deletedWords: [],
            gameStats: a.gameStats || {},
            achievements: a.achievements || {},
            srsStreakStats: a.srsStreakStats || {
                currentStreak: 0,
                lastStudyDate: "",
                bestStreak: 0
            },
            srsSettings: a.srsSettings || {
                newLimit: 10,
                sessionLimit: 20
            },
            shortcuts: {},
            onboardingCompleted: !1,
            settings: {},
            timestamp: Date.now()
        },
        i = a.savedWords || [],
        c = n.savedWords || [],
        l = a.deletedWords || [],
        m = n.deletedWords || [],
        d = new Map;
    m.forEach(e => {
        e && e.word && d.set(e.word.toLowerCase().trim(), e.deletedAt || 0)
    }), l.forEach(e => {
        if (e && e.word) {
            const t = e.word.toLowerCase().trim(),
                o = d.get(t) || 0;
            (e.deletedAt || 0) > o && d.set(t, e.deletedAt || 0)
        }
    });
    const u = Array.from(d.entries()).map(([e, t]) => ({
        word: e,
        deletedAt: t
    }));
    r.deletedWords = u;
    const g = new Map;
    c.forEach(e => {
        if (e && e.word) {
            const t = e.word.toLowerCase().trim(),
                o = d.get(t),
                a = e.updatedAt || e.createdAt || e.timestamp || 0;
            (!o || a > o) && g.set(t, {
                ...e
            })
        }
    }), i.forEach(e => {
        if (e && e.word) {
            const t = e.word.toLowerCase().trim(),
                o = d.get(t),
                a = e.updatedAt || e.createdAt || e.timestamp || 0;
            if (o && a <= o) return;
            if (g.has(t)) {
                const o = g.get(t),
                    n = o.updatedAt || o.createdAt || o.timestamp || 0,
                    s = a >= n ? e : o,
                    r = a >= n ? o : e,
                    i = Array.from(new Set([...s.examples || [], ...r.examples || []])),
                    c = Array.from(new Set([...s.translations || [], ...r.translations || []]));
                g.set(t, {
                    ...r,
                    ...s,
                    examples: i,
                    translations: c,
                    notes: s.notes || r.notes || "",
                    context: s.context || r.context || "",
                    sourceTitle: s.sourceTitle || r.sourceTitle || "",
                    box: Math.max(s.box || 1, r.box || 1),
                    nextReview: Math.max(s.nextReview || 0, r.nextReview || 0),
                    studyCount: Math.max(s.studyCount || 0, r.studyCount || 0),
                    learned: void 0 !== s.learned ? s.learned : void 0 !== r.learned && r.learned,
                    favorite: void 0 !== s.favorite ? s.favorite : void 0 !== r.favorite && r.favorite
                })
            } else g.set(t, {
                ...e
            })
        }
    }), r.savedWords = Array.from(g.values()).sort((e, t) => (t.createdAt || t.timestamp || 0) - (e.createdAt || e.timestamp || 0));
    const p = n.gameStats || {},
        h = a.gameStats || {};
    r.gameStats = {
        totalScore: (h.totalScore || 0) + (p.totalScore || 0),
        gamesPlayed: (h.gamesPlayed || 0) + (p.gamesPlayed || 0),
        wordsLearned: (h.wordsLearned || 0) + (p.wordsLearned || 0),
        streak: Math.max(h.streak || 0, p.streak || 0),
        bestScore: Math.max(h.bestScore || 0, p.bestScore || 0),
        timestamp: Date.now()
    };
    const y = n.achievements || {},
        f = a.achievements || {};
    if (r.achievements = {
            ...y,
            ...f
        }, "object" == typeof f && "object" == typeof y) {
        new Set([...Object.keys(f), ...Object.keys(y)]).forEach(e => {
            r.achievements[e] = f[e] || y[e]
        })
    }
    const w = n.srsStreakStats || {},
        S = a.srsStreakStats || {};
    if (S.timestamp && (!w.timestamp || S.timestamp > w.timestamp)) r.srsStreakStats = {
        ...S
    };
    else if (w.timestamp && (!S.timestamp || w.timestamp > S.timestamp)) r.srsStreakStats = {
        ...w
    };
    else {
        const e = (new Date).toDateString(),
            t = new Date;
        t.setDate(t.getDate() - 1);
        const o = t.toDateString(),
            a = S.lastStudyDate === e || S.lastStudyDate === o,
            n = w.lastStudyDate === e || w.lastStudyDate === o,
            s = a && S.currentStreak || 0,
            i = n && w.currentStreak || 0;
        let c = 0,
            l = "";
        if (a && n) {
            const e = new Date(S.lastStudyDate),
                t = new Date(w.lastStudyDate);
            e > t ? (c = s, l = S.lastStudyDate) : t > e ? (c = i, l = w.lastStudyDate) : (c = Math.max(s, i), l = S.lastStudyDate)
        } else if (a) c = s, l = S.lastStudyDate;
        else if (n) c = i, l = w.lastStudyDate;
        else {
            c = 0;
            l = (S.lastStudyDate ? new Date(S.lastStudyDate) : new Date(0)) > (w.lastStudyDate ? new Date(w.lastStudyDate) : new Date(0)) ? S.lastStudyDate || "" : w.lastStudyDate || S.lastStudyDate || ""
        }
        r.srsStreakStats = {
            currentStreak: c,
            bestStreak: Math.max(S.bestStreak || 0, w.bestStreak || 0),
            lastStudyDate: l
        }
    }
    const _ = n.srsSettings || {},
        v = a.srsSettings || {},
        k = !a.lastGoogleSyncTime || !v.timestamp || _.timestamp && _.timestamp > v.timestamp;
    r.srsSettings = k ? {
        newLimit: void 0 !== _.newLimit ? _.newLimit : void 0 !== v.newLimit ? v.newLimit : 10,
        sessionLimit: void 0 !== _.sessionLimit ? _.sessionLimit : void 0 !== v.sessionLimit ? v.sessionLimit : 20,
        timestamp: _.timestamp || v.timestamp || Date.now()
    } : {
        newLimit: void 0 !== v.newLimit ? v.newLimit : void 0 !== _.newLimit ? _.newLimit : 10,
        sessionLimit: void 0 !== v.sessionLimit ? v.sessionLimit : void 0 !== _.sessionLimit ? _.sessionLimit : 20,
        timestamp: v.timestamp || _.timestamp || Date.now()
    };
    const b = n.settings || {},
        E = !a.lastGoogleSyncTime || !s.timestamp || b.timestamp && b.timestamp > s.timestamp;
    return r.settings = E ? {
        ...s,
        ...b,
        youtube: {
            ...s.youtube || {},
            ...b.youtube || {}
        },
        prime: {
            ...s.prime || {},
            ...b.prime || {}
        },
        netflix: {
            ...s.netflix || {},
            ...b.netflix || {}
        },
        appLanguage: b.appLanguage || s.appLanguage || "auto",
        gamesSound: void 0 !== b.gamesSound ? b.gamesSound : void 0 === s.gamesSound || s.gamesSound,
        gamesAutoPronounce: void 0 !== b.gamesAutoPronounce ? b.gamesAutoPronounce : void 0 !== s.gamesAutoPronounce ? s.gamesAutoPronounce : b.autoplaySound || s.autoplaySound || !1,
        autoplaySound: void 0 !== b.autoplaySound ? b.autoplaySound : void 0 !== s.autoplaySound && s.autoplaySound,
        enabledPlatforms: {
            ...s.enabledPlatforms || {},
            ...b.enabledPlatforms || {}
        },
        timestamp: b.timestamp || s.timestamp || Date.now()
    } : {
        ...b,
        ...s,
        youtube: {
            ...b.youtube || {},
            ...s.youtube || {}
        },
        prime: {
            ...b.prime || {},
            ...s.prime || {}
        },
        netflix: {
            ...b.netflix || {},
            ...s.netflix || {}
        },
        appLanguage: s.appLanguage || b.appLanguage || "auto",
        gamesSound: void 0 !== s.gamesSound ? s.gamesSound : void 0 === b.gamesSound || b.gamesSound,
        gamesAutoPronounce: void 0 !== s.gamesAutoPronounce ? s.gamesAutoPronounce : void 0 !== b.gamesAutoPronounce ? b.gamesAutoPronounce : s.autoplaySound || b.autoplaySound || !1,
        autoplaySound: void 0 !== s.autoplaySound ? s.autoplaySound : void 0 !== b.autoplaySound && b.autoplaySound,
        enabledPlatforms: {
            ...b.enabledPlatforms || {},
            ...s.enabledPlatforms || {}
        },
        timestamp: s.timestamp || b.timestamp || Date.now()
    }, r.onboardingCompleted = a.onboardingCompleted || n.onboardingCompleted || !1, r.shortcuts = {
        ...SYNC_DEFAULT_SHORTCUTS,
        ...n.shortcuts || {},
        ...a.shortcuts || {}
    }, r
}
async function performGoogleDriveSync(e = !1) {
    if (!e) {
        if (!(await new Promise(e => chrome.storage.local.get({
                googleSyncEmail: "",
                googleSyncEnabled: !1
            }, e))).googleSyncEmail) return {
            success: !1,
            reason: "logged_out"
        }
    }
    await new Promise(e => chrome.storage.local.set({
        isSyncInProgress: !0
    }, e));
    try {
        const t = await getGoogleAuthToken(e);
        if (!t) {
            if (e) throw new Error("Google yetkilendirme jetonu alınamadı.");
            return {
                success: !1,
                reason: "no_token"
            }
        }
        const o = await getGoogleUserInfo(t);
        if (!o || !o.email) {
            if (e) throw new Error("Kullanıcı bilgisi alınamadı.");
            return {
                success: !1,
                reason: "userinfo_failed"
            }
        }
        const a = o.email,
            n = o.picture || "";
        let s = null;
        try {
            s = "undefined" != typeof PV_ApiClient && "function" == typeof PV_ApiClient.checkLicense ? await PV_ApiClient.checkLicense(a) : await new Promise(e => {
                chrome.runtime.sendMessage({
                    action: "api_check_license",
                    email: a
                }, t => {
                    chrome.runtime.lastError;
                    e(t || null)
                })
            })
        } catch (e) {
            s = null
        }
        const r = !!(s && s.success && s.data && s.data.isNewRegistration),
            i = await new Promise(e => {
                chrome.storage.local.get({
                    licenseType: "FREE",
                    isPremium: !1,
                    googleSyncEmail: ""
                }, e)
            });
        if (!i.googleSyncEmail) return {
            success: !1,
            reason: "logged_out"
        };
        if (!(!0 === i.isPremium || "FREE" !== i.licenseType)) {
            (await new Promise(e => chrome.storage.local.get({
                googleSyncEmail: ""
            }, e))).googleSyncEmail && await new Promise(e => {
                chrome.storage.local.set({
                    googleSyncEmail: a,
                    googleSyncPicture: n
                }, e)
            });
            const e = await new Promise(e => {
                chrome.storage.local.get({
                    savedWords: [],
                    lastGoogleSyncTime: 0,
                    googleSyncEmail: ""
                }, e)
            });
            if (!e.googleSyncEmail) return {
                success: !1,
                reason: "logged_out"
            };
            const o = e.savedWords && e.savedWords.length > 0,
                s = !!e.lastGoogleSyncTime;
            if (!o && !s) try {
                const e = await findSyncFile(t);
                if (e) {
                    const o = await downloadSyncFile(t, e);
                    if (o && o.savedWords && o.savedWords.length > 0) {
                        (await new Promise(e => chrome.storage.local.get({
                            googleSyncEmail: ""
                        }, e))).googleSyncEmail && (await new Promise(e => {
                            chrome.storage.local.set({
                                savedWords: o.savedWords || [],
                                deletedWords: o.deletedWords || [],
                                gameStats: o.gameStats || {},
                                achievements: o.achievements || {},
                                srsStreakStats: o.srsStreakStats || {
                                    currentStreak: 0,
                                    lastStudyDate: "",
                                    bestStreak: 0
                                },
                                srsSettings: o.srsSettings || {
                                    newLimit: 10,
                                    sessionLimit: 20
                                },
                                onboardingCompleted: !!o.onboardingCompleted
                            }, e)
                        }), console.log(`[PV-Sync] One-time restore: ${o.savedWords.length} kelime geri yüklendi.`))
                    }
                }
            } catch (e) {
                console.warn("[PV-Sync] One-time restore başarısız:", e)
            }
            throw new Error(r ? "PREMIUM_REQUIRED_SILENT" : "PREMIUM_REQUIRED")
        }
        if (!(await new Promise(e => chrome.storage.local.get({
                googleSyncEmail: ""
            }, e))).googleSyncEmail) return {
            success: !1,
            reason: "logged_out"
        };
        await new Promise(e => {
            chrome.storage.local.set({
                googleSyncEmail: a,
                googleSyncPicture: n
            }, e)
        });
        const c = await new Promise(e => {
            chrome.storage.local.get({
                savedWords: [],
                deletedWords: [],
                gameStats: {},
                achievements: {},
                srsStreakStats: {
                    currentStreak: 0,
                    lastStudyDate: "",
                    bestStreak: 0
                },
                srsSettings: {
                    newLimit: 10,
                    sessionLimit: 20
                },
                shortcuts: SYNC_DEFAULT_SHORTCUTS,
                onboardingCompleted: !1,
                lastGoogleSyncTime: 0,
                googleSyncEmail: ""
            }, e)
        });
        if (!c.googleSyncEmail) return {
            success: !1,
            reason: "logged_out"
        };
        const l = (await new Promise(e => {
                chrome.storage.sync.get({
                    settings: {}
                }, e)
            })).settings || {},
            m = await findSyncFile(t);
        let d = {
            savedWords: [],
            deletedWords: [],
            gameStats: {},
            achievements: {}
        };
        if (m) try {
            const e = await downloadSyncFile(t, m);
            e && "object" == typeof e && (d = e)
        } catch (e) {
            console.warn("[PV-Sync] Failed to download cloud file, using empty default", e)
        }
        const u = mergeSyncData(c, d, l);
        return (await new Promise(e => chrome.storage.local.get({
            googleSyncEmail: ""
        }, e))).googleSyncEmail ? (await new Promise(e => {
            chrome.storage.local.set({
                savedWords: u.savedWords,
                deletedWords: u.deletedWords || [],
                gameStats: u.gameStats,
                achievements: u.achievements,
                srsStreakStats: u.srsStreakStats,
                srsSettings: u.srsSettings,
                shortcuts: u.shortcuts,
                onboardingCompleted: u.onboardingCompleted,
                lastGoogleSyncTime: Date.now(),
                googleSyncEmail: a,
                googleSyncPicture: n
            }, e)
        }), await new Promise(e => {
            chrome.storage.sync.set({
                settings: u.settings
            }, e)
        }), await uploadSyncFile(t, m, u), {
            email: a,
            picture: n,
            totalWords: u.savedWords.length,
            settings: u.settings
        }) : {
            success: !1,
            reason: "logged_out"
        }
    } finally {
        await new Promise(e => chrome.storage.local.set({
            isSyncInProgress: !1
        }, e))
    }
}
"undefined" != typeof window && (window.connectGoogleAccount = connectGoogleAccount, window.triggerGoogleLogin = connectGoogleAccount);