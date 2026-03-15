#!/usr/bin/env bash
set -euo pipefail

echo "Backend (4000):"
lsof -nP -iTCP:4000 -sTCP:LISTEN || true
echo
echo "Frontend (5173):"
lsof -nP -iTCP:5173 -sTCP:LISTEN || true
