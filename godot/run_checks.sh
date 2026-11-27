#!/usr/bin/env bash
# Every check for the Godot build, in order: unit tests, the parity check against the JS
# sim, the audio wiring, the web export, the phone-size browser suite and the save-sharing check. From the
# repo root or godot/:
#   bash godot/run_checks.sh
# Needs godot (studio/setup-godot.sh installs it in a cloud session), node and the
# pre-installed Playwright Chromium. Exit code 1 on the first failure.
set -euo pipefail
cd "$(dirname "$0")"
GODOT=${GODOT:-godot}
TMP=$(mktemp -d)
cleanup() { [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "== import"
"$GODOT" --headless --path . --import >/dev/null 2>&1 || true

echo "== unit tests (tests/run_tests.gd)"
"$GODOT" --headless --path . --script res://tests/run_tests.gd 2>&1 | grep -E "^(ok|FAIL)|passed|^       "

echo "== parity with the JS sim (tests/parity.gd vs tools/parity.mjs)"
node tools/parity.mjs > "$TMP/js.json"
"$GODOT" --headless --path . --script res://tests/parity.gd -- "$TMP/godot.json" >/dev/null 2>&1
node tools/compare.mjs "$TMP/js.json" "$TMP/godot.json"

echo "== audio wiring (tests/audio_check.gd)"
"$GODOT" --headless --audio-driver Dummy --path . --script res://tests/audio_check.gd 2>&1 | grep -E "^(ok|FAIL)|failure"

echo "== web export"
mkdir -p build/web
"$GODOT" --headless --path . --export-release "Web" build/web/index.html >/dev/null 2>&1
ls build/web/index.pck >/dev/null

echo "== browser checks at 360x740 (serving the repo root, so both builds share an origin)"
(cd .. && python3 -m http.server 8779 >/dev/null 2>&1) &
SERVER=$!
for _ in $(seq 1 50); do curl -s localhost:8779 >/dev/null && break; sleep 0.1; done
SKYRISE_GODOT_URL=http://localhost:8779/godot/build/web/index.html node tests/web_check.js
SKYRISE_ROOT=http://localhost:8779 node tests/interop_check.js
echo "== all checks passed"
