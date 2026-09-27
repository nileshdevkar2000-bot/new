#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://127.0.0.1:3000}
COOKIE=$(mktemp); trap 'rm -f "$COOKIE"' EXIT
curl -fsS "$BASE/healthz" >/dev/null
curl -fsS "$BASE/api/public-status" >/dev/null
curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' -d '{"id":"neo.admin","password":"'"${NEO_ADMIN_PASSWORD:-Admin@123}"'"}' "$BASE/api/login" >/dev/null
curl -fsS -b "$COOKIE" "$BASE/api/session" >/dev/null
echo "NEO auth smoke test passed"
