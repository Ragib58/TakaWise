#!/usr/bin/env bash
# Post-deploy smoke test (staging and production). Read-only; creates no data.
#   API_URL=https://api.staging.example WEB_URL=https://app.staging.example ./infra/scripts/smoke.sh
set -euo pipefail
: "${API_URL:?API_URL is required (origin, without /api/v1)}"
: "${WEB_URL:?WEB_URL is required}"

fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "→ liveness";   [ "$(status "$API_URL/api/v1/health")" = 200 ] || fail "health"
echo "→ readiness"
ready="$(curl -fsS "$API_URL/api/v1/health/ready")" || fail "ready endpoint"
echo "$ready" | grep -q '"database":"up"' || fail "database not up: $ready"
echo "$ready" | grep -q '"redis":"up"' || fail "redis not up: $ready"
echo "→ default deny"; [ "$(status "$API_URL/api/v1/accounts")" = 401 ] || fail "/accounts must be 401 without a token"
echo "→ metrics not public"; code="$(status "$API_URL/api/v1/metrics")"; [ "$code" = 401 ] || [ "$code" = 404 ] || fail "metrics returned $code"
echo "→ swagger off";  [ "$(status "$API_URL/api/docs")" = 404 ] || fail "Swagger must be disabled in production"
echo "→ API headers"
# Capture first: with pipefail, `curl | grep -q` fails when grep exits early (SIGPIPE).
api_headers="$(curl -sSI "$API_URL/api/v1/health")"
echo "$api_headers" | grep -qi '^strict-transport-security:' || fail "HSTS missing on API"
echo "→ web"
headers="$(curl -sSI "$WEB_URL/login")"
echo "$headers" | head -1 | grep -q ' 200' || fail "web /login not 200"
echo "$headers" | grep -qi "^content-security-policy:.*frame-ancestors 'none'" || fail "CSP missing on web"
echo "SMOKE PASS"
