#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGDIR="$ROOT/.runlogs"
mkdir -p "$LOGDIR"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids >/dev/null 2>&1 || true
    sleep 0.5
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      # shellcheck disable=SC2086
      kill -9 $pids >/dev/null 2>&1 || true
    fi
  fi
}

# Always clear occupied app ports.
kill_port 4000
kill_port 5173

# Start backend with direct binary (no watch mode, no npm wrapper)
nohup bash -lc "cd '$ROOT/backend' && ./node_modules/.bin/tsx src/index.ts" >"$LOGDIR/backend.log" 2>&1 &
echo $! >"$LOGDIR/backend.pid"

# Start frontend with direct vite binary on fixed port
nohup bash -lc "cd '$ROOT/frontend' && ./node_modules/.bin/vite --host 127.0.0.1 --port 5173 --strictPort" >"$LOGDIR/frontend.log" 2>&1 &
echo $! >"$LOGDIR/frontend.pid"

for _ in {1..40}; do
  if lsof -ti tcp:4000 >/dev/null 2>&1 && lsof -ti tcp:5173 >/dev/null 2>&1; then
    echo "App is running"
    echo "Frontend: http://127.0.0.1:5173"
    echo "Backend:  http://127.0.0.1:4000"
    exit 0
  fi
  sleep 1
done

echo "Startup timed out. Recent logs:"
echo "--- backend.log ---"
tail -n 80 "$LOGDIR/backend.log" || true
echo "--- frontend.log ---"
tail -n 80 "$LOGDIR/frontend.log" || true
exit 1
