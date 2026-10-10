# Checklist

## A) Before every release
- [ ] `bash scripts/verify.sh` is green (CI runs it first: web bundle + patches, JS syntax, XML, manifest permissions, Java compile, HTTP-server tests).
- [ ] Actions run is green and the **"Check the APK"** step shows `package: name='app.proudvocab.android'`, `sdkVersion:'28'`, one `uses-permission` (INTERNET).
- [ ] The tag is higher than the previous one (`android-v1.0.1` > `android-v1.0.0`) - Android refuses to install a lower versionCode over a higher one.
- [ ] The same keystore was used (otherwise the phone shows *App not installed* / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`).

## B) What was verified for this build
| Area | How | Result |
|---|---|---|
| All Java compiles against **Android API 34 and API 28** (`minSdk` proof: no API > 28 is used) | `javac` against `android.jar` 34 and 28 | pass |
| Local HTTP server (assets, `Range` seeking, 416, token, Host check, path traversal) + path helpers | `scripts/jtest/ServerSmokeTest.java` | 26/26 |
| Every SQL statement of the offline dictionary | run against `dictionaryproject/docs/sample.sqlite` (`scripts/test-dictionary-sql.py`) | 18/18 |
| Whole web layer (shell + player + panel + background) in a real Chromium with a faked Android bridge | `scripts/e2e/run.sh` (Electron + Xvfb) | 44/44 |
| License / premium removal | e2e: unlimited plan seeded, FREE writes coerced, 75 saved words kept, no premium locks, no license-server request, upgrade UI hidden | pass |
| Playback | e2e: MP4 + MKV(H.264) stream through the Range server, play/seek, subtitles become tappable words | pass |
| Offline dictionary | e2e: import → search → entry → translate EN⇄FA before Google, fallback to Google, switch off | pass |
| Downloads / exports | e2e: `blob:` download is routed to the system "Save as" dialog | pass |
| Signing | `jarsigner` with the committed keystore + exact Gradle credentials | pass |
| YAML of the workflow | parsed | pass |

**Not possible in the build sandbox (so please confirm on GitHub / the phone):** running Gradle/AGP itself and running on a real device.
That is what the CI run and section D are for.

## C) CI failed? error → cause → fix
| You see | Cause | Fix |
|---|---|---|
| `PATCH FAILED  ext/...: expected N match(es)` in *Pre-build checklist* | `proudvocab-desktop` sources changed under a license-removal patch point | open `scripts/build-web.mjs`, adjust that regex, run `node scripts/build-web.mjs` |
| `FAIL  Java compile errors` | a Java edit is wrong | the javac message shows file:line |
| `FAIL  ServerSmokeTest` | HTTP server / path helper regression | run `bash scripts/verify.sh` locally |
| `SDK location not found` / `License for package ... not accepted` | runner image without the SDK | the *Make sure the Android SDK pieces exist* step installs them; re-run |
| `Unsupported class file major version` / `requires JDK 17` | wrong JDK | the workflow pins JDK 17 - do not change it |
| `Keystore was tampered with, or password was incorrect` | `PV_*` variables or the keystore file do not match | use the defaults (password `proudvocab`, alias `proudvocab`) or update all four variables |
| `APK not found` | Gradle failed earlier | read the *Build the signed release APK* log (`--stacktrace` is on) |
| *Publish the GitHub Release* → `Resource not accessible by integration` | Actions has read-only token | Settings → Actions → General → Workflow permissions → **Read and write** |

## D) On-device test list (POCO X3 Pro, ~5 minutes)
- [ ] Install the APK; it opens to the splash and then the player. No permission dialogs appear.
- [ ] *Open video*: pick an `.mp4` **and** its `.srt` together → video plays, subtitle words are underlined/clickable.
- [ ] Seek by dragging the progress bar; pause/resume; tap once to show controls, tap again to pause.
- [ ] Tap a word → tooltip with translation (needs internet) → *Save* → it appears in the panel's list.
- [ ] Save more than 50 words → none are hidden/locked; Games / SRS / smart settings are not locked.
- [ ] Rotate the phone: portrait = video above panel, landscape = side by side. Fullscreen button → landscape + bars hidden; Back leaves fullscreen.
- [ ] Panel → Archive → export JSON → the system "Save as" dialog appears; restore from that file works.
- [ ] 📖 → import your dictionary file → status shows word counts → search "propag…" → open an entry.
- [ ] Tap a word with the dictionary on and target language Persian → answer is instant and works in airplane mode.
- [ ] Close the app completely and reopen: words, settings and the last video position are still there.
- [ ] From the file manager: *Open with → ProudVocab* on a video starts playback.

If something fails, connect the phone with USB debugging and run `adb logcat -s PV-JS ProudVocab` - every JavaScript console message and native error is logged there.

## E) Known limits
See "نکات و محدودیت‌ها" in the README (codecs depend on the phone's WebView, folder access is needed for auto-found subtitles, Google-Drive sync is a browser-extension feature).
