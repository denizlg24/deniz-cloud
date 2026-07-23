#!/bin/bash

# SD card cleanup for the Pi's root filesystem.
# Reclaims Docker build cache / unused images, oversized container logs,
# systemd journals, and APT caches. Never touches /mnt/ssd or /mnt/hdd.
#
# Intended to run as a root cron job weekly:
#   0 4 * * 0 /home/denizlg24/deniz-cloud/scripts/infra/disk-cleanup.sh >> /var/log/disk-cleanup.log 2>&1
#
# Run with --dry-run to report what would be reclaimed without changing anything.

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

IMAGE_KEEP_HOURS="${IMAGE_KEEP_HOURS:-168}"     # keep unused images newer than 7 days
CACHE_KEEP_HOURS="${CACHE_KEEP_HOURS:-168}"     # keep build cache newer than 7 days
LOG_MAX_BYTES="${LOG_MAX_BYTES:-52428800}"      # truncate container logs over 50 MB
LOG_KEEP_LINES="${LOG_KEEP_LINES:-2000}"        # lines preserved when truncating
JOURNAL_MAX_SIZE="${JOURNAL_MAX_SIZE:-200M}"

log() { echo "[$(date -Iseconds)] $*"; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN: $*"
  else
    "$@"
  fi
}

used_kb() { df -kP / | awk 'NR==2 {print $3}'; }

if [[ $EUID -ne 0 ]]; then
  log "ERROR: must run as root (needs access to /var/lib/docker and journald)"
  exit 1
fi

BEFORE_KB="$(used_kb)"
log "=== disk cleanup starting (root fs used: $((BEFORE_KB / 1024)) MB) ==="

# --- Docker build cache -----------------------------------------------------
# The single biggest consumer. Build cache is regenerated on the next build.
if command -v docker >/dev/null 2>&1; then
  log "--- pruning build cache older than ${CACHE_KEEP_HOURS}h ---"
  run docker builder prune --force --all --filter "until=${CACHE_KEEP_HOURS}h"

  # Images with no container (running or stopped) attached to them. Compose
  # images in active use are always attached, so they survive this.
  log "--- pruning unused images older than ${IMAGE_KEEP_HOURS}h ---"
  run docker image prune --force --all --filter "until=${IMAGE_KEEP_HOURS}h"

  # --- Container logs -------------------------------------------------------
  # The json-file driver is unbounded unless log-opts are set. Preserve the
  # tail so recent history survives; whole complete lines only.
  log "--- truncating container logs over $((LOG_MAX_BYTES / 1024 / 1024)) MB ---"
  while IFS= read -r logfile; do
    size="$(stat -c %s "$logfile")"
    name="$(basename "$(dirname "$logfile")")"
    log "  ${name:0:12}: $((size / 1024 / 1024)) MB -> keeping last ${LOG_KEEP_LINES} lines"
    if [[ $DRY_RUN -eq 0 ]]; then
      tail -n "$LOG_KEEP_LINES" "$logfile" > "${logfile}.trim" 2>/dev/null || continue
      cat "${logfile}.trim" > "$logfile"
      rm -f "${logfile}.trim"
    fi
  done < <(find /var/lib/docker/containers -name '*-json.log' -size +"$((LOG_MAX_BYTES / 1024))"k 2>/dev/null)
else
  log "docker not found, skipping Docker cleanup"
fi

# --- systemd journal --------------------------------------------------------
log "--- vacuuming journal to ${JOURNAL_MAX_SIZE} ---"
run journalctl --vacuum-size="$JOURNAL_MAX_SIZE"

# --- APT --------------------------------------------------------------------
log "--- cleaning APT cache and orphaned packages (old kernels) ---"
run apt-get clean
run apt-get autoremove --purge -y

# --- summary ----------------------------------------------------------------
AFTER_KB="$(used_kb)"
FREED_MB=$(((BEFORE_KB - AFTER_KB) / 1024))
AVAIL_MB="$(df -mP / | awk 'NR==2 {print $4}')"
log "=== done: freed ${FREED_MB} MB, ${AVAIL_MB} MB now available on / ==="
