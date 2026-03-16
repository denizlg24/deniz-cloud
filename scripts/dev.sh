#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

PIDS=()

cleanup() {
  echo ""
  echo "[dev] Shutting down..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid" 2>/dev/null
    fi
  done
  # Give processes a moment to exit, then force kill
  sleep 1
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null
    fi
  done
  echo "[dev] All servers stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "[dev] Starting infrastructure containers..."
docker compose -f docker-compose.local.yml up -d

echo "[dev] Waiting for services to be healthy..."
docker compose -f docker-compose.local.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-denizcloud}" > /dev/null 2>&1 || sleep 3

echo "[dev] Starting dev servers..."

bun run dev:storage-api &
PIDS+=($!)
bun run dev:storage-ui &
PIDS+=($!)
bun run dev:admin-api &
PIDS+=($!)
bun run dev:admin-ui &
PIDS+=($!)

echo "[dev] All servers started. Press Ctrl+C to stop."

wait
