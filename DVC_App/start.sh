#!/bin/bash
# start.sh — Lance dvc-app (backend + frontend)

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=${BACKEND_PORT:-8002}
FRONTEND_PORT=${FRONTEND_PORT:-3002}
DVC_REPO_PATH=${DVC_REPO_PATH:-"$APP_DIR/data/repo"}

echo "[dvc-app] DVC_REPO_PATH : $DVC_REPO_PATH"
echo "[dvc-app] Demarrage backend (port $BACKEND_PORT)..."

cd "$APP_DIR"
BACKEND_PORT=$BACKEND_PORT \
DVC_APP_FRONTEND_PORT=$FRONTEND_PORT \
DVC_REPO_PATH=$DVC_REPO_PATH \
python -m uvicorn backend.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

for i in $(seq 1 30); do
  curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1 && break
  sleep 1
done

echo "[dvc-app] Demarrage frontend (port $FRONTEND_PORT)..."
cd "$APP_DIR/frontend"
VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!

echo ""
echo "[dvc-app] http://localhost:$FRONTEND_PORT"
echo "[dvc-app] Ctrl+C pour arreter"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
