#!/usr/bin/env bash
# start.sh — lance orchestrator-app (backend + frontend)

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=${BACKEND_PORT:-8000}
FRONTEND_PORT=${ORCHESTRATOR_FRONTEND_PORT:-3000}

echo "[orchestrator-app] Démarrage backend  (port $BACKEND_PORT)..."
uvicorn backend.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

echo "[orchestrator-app] Démarrage frontend (port $FRONTEND_PORT)..."
cd frontend
VITE_BACKEND_PORT="$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!
cd ..

echo "[orchestrator-app] Backend  : http://localhost:$BACKEND_PORT/docs"
echo "[orchestrator-app] Frontend : http://localhost:$FRONTEND_PORT"
echo "[orchestrator-app] Ctrl+C pour arrêter"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
