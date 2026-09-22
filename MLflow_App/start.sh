#!/bin/bash
# start.sh — Lance mlflow-app (backend + frontend)
# Usage : bash start.sh

set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=${BACKEND_PORT:-8001}
FRONTEND_PORT=${FRONTEND_PORT:-3001}

echo "[mlflow-app] Demarrage du backend (port $BACKEND_PORT)..."
cd "$APP_DIR"
BACKEND_PORT=$BACKEND_PORT \
MLFLOW_APP_FRONTEND_PORT=$FRONTEND_PORT \
python -m uvicorn backend.main:app \
  --host 0.0.0.0 \
  --port "$BACKEND_PORT" \
  --reload &

BACKEND_PID=$!
echo "[mlflow-app] Backend PID: $BACKEND_PID"

# Attendre que le backend soit pret
echo "[mlflow-app] Attente du backend..."
for i in $(seq 1 30); do
  if curl -s "http://localhost:$BACKEND_PORT/health" > /dev/null 2>&1; then
    echo "[mlflow-app] Backend pret"
    break
  fi
  sleep 1
done

echo "[mlflow-app] Demarrage du frontend (port $FRONTEND_PORT)..."
cd "$APP_DIR/frontend"
VITE_BACKEND_PORT=$BACKEND_PORT npm run dev -- --port "$FRONTEND_PORT" &

FRONTEND_PID=$!
echo "[mlflow-app] Frontend PID: $FRONTEND_PID"
echo ""
echo "[mlflow-app] Application disponible sur http://localhost:$FRONTEND_PORT"
echo "[mlflow-app] Ctrl+C pour arreter"

# Arreter les deux processus au signal
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
wait
