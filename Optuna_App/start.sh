#!/usr/bin/env bash
# start.sh — launch optuna-app backend + frontend concurrently

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PORT=${BACKEND_PORT:-8003}
FRONTEND_PORT=${OPTUNA_APP_FRONTEND_PORT:-3003}

echo "[optuna-app] Demarrage backend (port $BACKEND_PORT)..."
uvicorn backend.main:app --host 0.0.0.0 --port "$BACKEND_PORT" --reload &
BACKEND_PID=$!

echo "[optuna-app] Demarrage frontend (port $FRONTEND_PORT)..."
cd frontend
VITE_BACKEND_PORT="$BACKEND_PORT" npm run dev -- --port "$FRONTEND_PORT" &
FRONTEND_PID=$!
cd ..

echo "[optuna-app] Backend PID=$BACKEND_PID  Frontend PID=$FRONTEND_PID"
echo "[optuna-app] Frontend : http://localhost:$FRONTEND_PORT"
echo "[optuna-app] Backend  : http://localhost:$BACKEND_PORT/docs"
echo "[optuna-app] Ctrl+C pour arreter"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
