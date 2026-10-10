#!/usr/bin/env bash
# usage: scripts/e2e/run.sh <fixturesDir> [electronDir]
set -e
cd "$(dirname "$0")/../.."
FIX="${1:?fixtures dir (clip.mp4, clip.mkv, clip.srt, sample.sqlite)}"
EL="${2:-$HOME/e2e/node_modules/electron/dist/electron}"
rm -rf /tmp/pv-shots
timeout 300 xvfb-run -a -s "-screen 0 1280x1024x24" "$EL" --no-sandbox scripts/e2e/run.cjs "$FIX" "$FIX/sample.sqlite" 2>&1 \
  | grep -v -E "^\[[0-9]+:|dbus|Gtk|libva|ALSA|gpu|GPU|deprecated and will be removed"
