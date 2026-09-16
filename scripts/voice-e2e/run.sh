#!/usr/bin/env bash
# Automated end-to-end VOICE tests for Ema.
#
# Drives real Grok speech-to-speech conversations against the live widget by
# injecting Gemini-TTS audio as the microphone (via a getUserMedia shim), then
# asserts the continuity behaviors that broke in production: memory across
# X-close/reopen and across a full page reload.
#
# Runs inside the existing `hermes-playwright` container (Chromium already there),
# talking to the app over the internal Docker network so we avoid public NAT
# hairpin and can flag the http origin as secure (voice needs a secure context).
#
# Prereqs on this host: docker; the tempest stack up (tempest-ema on tempest-net);
# hermes-playwright container running; GEMINI_API_KEY in ../../deploy/.env.
#
# Usage:  bash scripts/voice-e2e/run.sh
set -euo pipefail

PW=hermes-playwright
EMA_ORIGIN="${EMA_ORIGIN:-http://tempest-ema:8080}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENVFILE="$(cd "$HERE/../../deploy" && pwd)/.env"

echo "==> ensuring $PW is on the tempest network"
NET="$(docker inspect tempest-ema --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
docker network connect "$NET" "$PW" 2>/dev/null || true

echo "==> ensuring playwright-core is installed in $PW (/tmp/vt)"
docker exec "$PW" sh -lc 'test -d /tmp/vt/node_modules/playwright-core || (mkdir -p /tmp/vt && cd /tmp/vt && npm init -y >/dev/null 2>&1 && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright-core@1.55.0 --no-audit --no-fund >/dev/null 2>&1) ; echo ok'

echo "==> copying suite into $PW (/tmp is tmpfs, so pipe via stdin)"
base64 -w0 "$HERE/vt-suite.mjs" | docker exec -i "$PW" sh -c 'base64 -d > /tmp/vt/vt-suite.mjs'

echo "==> running voice suite (this makes real Grok voice calls; ~5 min)"
TMPENV="$(mktemp)"; grep -E '^GEMINI_API_KEY=' "$ENVFILE" > "$TMPENV"
trap 'rm -f "$TMPENV"' EXIT
docker exec --env-file "$TMPENV" -e EMA_ORIGIN="$EMA_ORIGIN" "$PW" sh -lc 'cd /tmp/vt && node vt-suite.mjs'
