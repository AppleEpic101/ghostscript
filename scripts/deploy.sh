#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

pids=()
API_PORT="${PAIRING_API_PORT:-}"
APP_PORT="${PAIRING_APP_PORT:-}"

is_port_in_use() {
  local port="$1"

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    const server = net.createServer();
    server.once("error", () => process.exit(0));
    server.once("listening", () => server.close(() => process.exit(1)));
    server.listen(port, "127.0.0.1");
  ' "$port"
}

find_available_port() {
  local start_port="$1"
  local port="$start_port"

  while is_port_in_use "$port"; do
    port=$((port + 1))
  done

  echo "$port"
}

cleanup() {
  local pid

  for pid in "${pids[@]:-}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait "${pids[@]:-}" 2>/dev/null || true
}

run_service() {
  local name="$1"
  shift

  (
    "$@" 2>&1 | sed -u "s/^/[$name] /"
  ) &

  pids+=("$!")
}

trap cleanup EXIT INT TERM

if [[ -z "$API_PORT" ]]; then
  API_PORT="$(find_available_port 8787)"
fi

if [[ -z "$APP_PORT" ]]; then
  APP_PORT="$(find_available_port 5173)"
fi

API_BASE_URL="http://localhost:${API_PORT}"
APP_BASE_URL="http://localhost:${APP_PORT}"

run_service "api" env PAIRING_API_PORT="$API_PORT" PAIRING_APP_BASE_URL="$APP_BASE_URL" corepack pnpm --filter @ghostscript/pairing-api dev
run_service "web" env VITE_PAIRING_API_BASE_URL="$API_BASE_URL" corepack pnpm --filter @ghostscript/pairing-web exec vite --host localhost --port "$APP_PORT" --strictPort
run_service "extension" env VITE_PAIRING_API_BASE_URL="$API_BASE_URL" corepack pnpm --filter @ghostscript/extension dev

echo "Running API, frontend, and extension. Press Ctrl+C to stop all services."
echo "Pairing web: $APP_BASE_URL"
echo "Pairing API: $API_BASE_URL"

while true; do
  for pid in "${pids[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid"
      exit $?
    fi
  done

  sleep 1
done
