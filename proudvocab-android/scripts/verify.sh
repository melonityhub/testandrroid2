#!/usr/bin/env bash
# Pre-build checklist, runs locally and in CI before Gradle:
#   bash scripts/verify.sh
# Every section prints "ok" or "FAIL"; the script exits non-zero on any FAIL.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
ok()  { echo "  ok    $*"; }
bad() { echo "  FAIL  $*"; FAIL=1; }

echo "[1/6] web bundle (desktop renderer + Android overlay + license removal patches)"
if node scripts/build-web.mjs > /tmp/pv-build-web.log 2>&1; then
  ok "build-web.mjs: $(tail -1 /tmp/pv-build-web.log)"
else
  cat /tmp/pv-build-web.log; bad "build-web.mjs failed (a desktop source changed under a patch?)"
fi
if node --test test/*.test.mjs > /tmp/pv-web-test.log 2>&1; then
  ok "web regression tests: $(grep '^# pass ' /tmp/pv-web-test.log | tail -1)"
else
  cat /tmp/pv-web-test.log; bad "web regression tests failed"
fi
WWW=app/src/main/assets/www
n=0; badjs=0
while IFS= read -r f; do
  n=$((n+1))
  node --check "$f" 2>/tmp/pv-js.err || { badjs=$((badjs+1)); echo "    syntax error in $f"; head -3 /tmp/pv-js.err; }
done < <(find "$WWW" -name '*.js')
[ "$badjs" -eq 0 ] && ok "$n JavaScript files parse" || bad "$badjs JavaScript file(s) with syntax errors"
for f in index.html bg.html player/player.html ext/sidepanel/panel.html dict/dict.html android-bridge.js shell.js ext/chrome-shim.js ext/sidepanel/apiClient.js; do
  [ -s "$WWW/$f" ] || bad "missing asset $f"
done
grep -q 'android-bridge.js' "$WWW/player/player.html" && grep -q 'android-bridge.js' "$WWW/bg.html" \
  && grep -q 'android-bridge.js' "$WWW/ext/sidepanel/panel.html" && grep -q 'android-bridge.js' "$WWW/index.html" \
  && ok "android-bridge.js is the first script of every frame" || bad "android-bridge.js not injected everywhere"

echo "[2/6] license / premium logic is gone"
# the license API lived at script.google.com/macros; the prime-vocab-mobile.vercel.app endpoints that
# remain in background.js / panel_sync.js are only Google-Drive OAuth for the (hidden) cloud sync and are
# blocked by the fetch deny-list in chrome-shim.js.
if grep -rIl 'script.google.com/macros' "$WWW" --include='*.js' --include='*.html'; then
  bad "license API URL (script.google.com/macros) still present (listed above)"
else ok "license API URL is gone"; fi
grep -q 'BLOCKED_LICENSE_RE' "$WWW/ext/chrome-shim.js" && grep -q 'prime-vocab-mobile' "$WWW/ext/chrome-shim.js" \
  && ok "chrome-shim blocks the remaining vendor endpoints" || bad "chrome-shim deny-list missing"
grep -q 'return Promise.resolve(true)' "$WWW/ext/sidepanel/apiClient.js" && ok "apiClient.js is the network-free stub" || bad "apiClient.js is not the stub"
if grep -qE 'slice\(0,50\)' "$WWW/ext/content/inject_common.js"; then bad "50-word cap still in inject_common.js"; else ok "50-word cap removed"; fi

echo "[3/6] XML resources + manifest"
python3 - <<'PY' || FAIL=1
import glob, sys, xml.etree.ElementTree as ET
bad = 0
files = glob.glob('app/src/main/res/**/*.xml', recursive=True) + ['app/src/main/AndroidManifest.xml']
for f in files:
    try: ET.parse(f)
    except Exception as e: print('  FAIL  ', f, e); bad += 1
if not bad: print(f'  ok    {len(files)} XML files are well-formed')
sys.exit(1 if bad else 0)
PY
perms=$(grep -c '<uses-permission' app/src/main/AndroidManifest.xml)
if [ "$perms" -eq 1 ] && grep -q 'android.permission.INTERNET' app/src/main/AndroidManifest.xml; then ok "manifest requests exactly one permission (INTERNET)"; else bad "unexpected permissions in the manifest"; fi
grep -qE 'minSdk +28' app/build.gradle && ok "minSdk 28 (Android 9+)" || bad "minSdk is not 28"
for r in mipmap-anydpi/ic_launcher.xml mipmap-xxxhdpi/ic_launcher_foreground.png xml/network_security_config.xml values/themes.xml; do
  [ -f "app/src/main/res/$r" ] || bad "missing resource $r"
done
[ -f keystore/proudvocab-release.p12 ] && ok "signing keystore present" || bad "keystore/proudvocab-release.p12 missing"

echo "[4/6] Java compiles against the Android API"
JAR="${ANDROID_JAR:-}"
if [ -z "$JAR" ] && [ -n "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ]; then
  for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}"; do
    [ -f "$sdk/platforms/android-34/android.jar" ] && JAR="$sdk/platforms/android-34/android.jar" && break
  done
fi
OUT=$(mktemp -d)
SRC=app/src/main/java/app/proudvocab/android
if [ -n "$JAR" ] && [ -f "$JAR" ]; then
  mkdir -p "$OUT/rstub/app/proudvocab/android"
  cat > "$OUT/rstub/app/proudvocab/android/R.java" <<'JAVA'
package app.proudvocab.android;
public final class R { public static final class string { public static final int err_webview=1, dlg_ok=2, dlg_cancel=3, toast_saved=4, toast_save_failed=5; } }
JAVA
  if javac -nowarn -d "$OUT/cls" -cp "$JAR" $SRC/*.java "$OUT/rstub/app/proudvocab/android/R.java" 2> "$OUT/javac.log"; then ok "all Java sources compile against $(basename "$(dirname "$JAR")")"; else cat "$OUT/javac.log"; bad "Java compile errors"; fi
else
  echo "  (no android.jar found - set ANDROID_JAR or ANDROID_HOME; compiling the pure-Java part only)"
  javac -nowarn -d "$OUT/cls" $SRC/Paths.java $SRC/LocalServer.java 2> "$OUT/javac.log" && ok "Paths + LocalServer compile" || { cat "$OUT/javac.log"; bad "Java compile errors"; }
fi

echo "[5/6] HTTP server + path helpers (plain JVM test)"
if javac -nowarn -d "$OUT/test" $SRC/Paths.java $SRC/LocalServer.java scripts/jtest/ServerSmokeTest.java 2> "$OUT/t.log"; then
  if java -cp "$OUT/test" app.proudvocab.android.ServerSmokeTest > "$OUT/smoke.log" 2>&1; then ok "ServerSmokeTest: $(tail -1 "$OUT/smoke.log")"; else cat "$OUT/smoke.log"; bad "ServerSmokeTest failed"; fi
else cat "$OUT/t.log"; bad "could not compile ServerSmokeTest"; fi

echo "[6/6] result"
if [ "$FAIL" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$FAIL"
