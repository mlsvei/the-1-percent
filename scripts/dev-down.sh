#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$ROOT/.runlogs"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 0.3
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  fi
}

if [[ -f "$LOGDIR/backend.pid" ]]; then
  kill "$(cat "$LOGDIR/backend.pid")" >/dev/null 2>&1 || true
  rm -f "$LOGDIR/backend.pid"
fi
if [[ -f "$LOGDIR/frontend.pid" ]]; then
  kill "$(cat "$LOGDIR/frontend.pid")" >/dev/null 2>&1 || true
  rm -f "$LOGDIR/frontend.pid"
fi

kill_port 4000
kill_port 5173

echo "Stopped dev servers"
