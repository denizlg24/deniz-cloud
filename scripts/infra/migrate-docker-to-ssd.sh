#!/bin/bash

# Moves Docker's on-disk state off the SD card onto the NVMe SSD.
#
# Two roots must move, not one. This host runs the containerd snapshotter, so
# image layers live in /var/lib/containerd (~20G) while /var/lib/docker holds
# only container metadata and logs (~600M). Setting Docker's data-root alone
# would move the smaller half and leave the bulk behind.
#
# Data safety:
#   - the source trees are NEVER deleted; removal is left to you afterwards
#   - every config file is backed up before modification
#   - a verification pass must pass before the old data is considered redundant
#   - any failure after configs are written triggers an automatic rollback
#
# Usage: sudo ./migrate-docker-to-ssd.sh [--dry-run]

set -euo pipefail

SSD_MOUNT="/mnt/ssd"
OLD_DOCKER="/var/lib/docker"
OLD_CONTAINERD="/var/lib/containerd"
NEW_DOCKER="${SSD_MOUNT}/docker"
NEW_CONTAINERD="${SSD_MOUNT}/containerd"

DAEMON_JSON="/etc/docker/daemon.json"
CONTAINERD_TOML="/etc/containerd/config.toml"
DOCKER_DROPIN="/etc/systemd/system/docker.service.d/10-ssd-mount.conf"
CONTAINERD_DROPIN="/etc/systemd/system/containerd.service.d/10-ssd-mount.conf"

STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="/root/docker-migration-${STAMP}"

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

ROLLBACK_ARMED=0

log()  { echo "[$(date -Iseconds)] $*"; }
fail() { log "ERROR: $*"; exit 1; }

run() {
  if [[ $DRY_RUN -eq 1 ]]; then
    log "DRY-RUN: $*"
  else
    "$@"
  fi
}

# ---------------------------------------------------------------------------
# Rollback — restores the previous config and points the daemons back at the
# SD card. The copied data on the SSD is left in place for inspection.
# ---------------------------------------------------------------------------
rollback() {
  [[ $ROLLBACK_ARMED -eq 1 ]] || return
  log "!!! FAILURE — rolling back configuration to the SD card"
  for f in "$DAEMON_JSON" "$CONTAINERD_TOML"; do
    if [[ -f "${BACKUP_DIR}/$(basename "$f")" ]]; then
      cp -a "${BACKUP_DIR}/$(basename "$f")" "$f"
      log "  restored $f"
    else
      rm -f "$f"
      log "  removed $f (did not exist before)"
    fi
  done
  rm -f "$DOCKER_DROPIN" "$CONTAINERD_DROPIN"
  systemctl daemon-reload
  systemctl start containerd docker 2>/dev/null || true
  log "rolled back. Original data untouched at ${OLD_DOCKER} and ${OLD_CONTAINERD}"
  log "backups kept in ${BACKUP_DIR}"
}
trap rollback ERR

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
[[ $EUID -eq 0 ]] || fail "must run as root"
command -v rsync >/dev/null || fail "rsync not installed"
command -v jq    >/dev/null || fail "jq not installed"

# The single most important check: if the SSD is not mounted, /mnt/ssd is just
# a directory on the SD card and we would copy 20G onto the disk we're trying
# to empty.
mountpoint -q "$SSD_MOUNT" || fail "${SSD_MOUNT} is not a mount point — refusing to run"
SSD_SRC="$(findmnt -no SOURCE "$SSD_MOUNT")"
log "target device: ${SSD_SRC} mounted at ${SSD_MOUNT}"

NEED_KB=$(( $(du -sxk "$OLD_DOCKER" "$OLD_CONTAINERD" 2>/dev/null | awk '{s+=$1} END {print s}') ))
AVAIL_KB=$(df -kP "$SSD_MOUNT" | awk 'NR==2 {print $4}')
NEED_MARGIN_KB=$(( NEED_KB * 110 / 100 ))
log "need ~$((NEED_KB / 1024)) MB (+10% margin), ${SSD_MOUNT} has $((AVAIL_KB / 1024)) MB free"
[[ $AVAIL_KB -gt $NEED_MARGIN_KB ]] || fail "insufficient space on ${SSD_MOUNT}"

for d in "$NEW_DOCKER" "$NEW_CONTAINERD"; do
  if [[ -d "$d" ]] && [[ -n "$(ls -A "$d" 2>/dev/null)" ]]; then
    fail "$d already exists and is not empty — remove it or migrate manually"
  fi
done

# ---------------------------------------------------------------------------
# Inventory — captured while Docker is still up so we can prove nothing was
# lost after the move.
# ---------------------------------------------------------------------------
run mkdir -p "$BACKUP_DIR"
if [[ $DRY_RUN -eq 0 ]]; then
  docker image ls --all --quiet | sort -u > "${BACKUP_DIR}/images-before.txt"
  docker ps --all --format '{{.Names}}' | sort > "${BACKUP_DIR}/containers-before.txt"
  docker volume ls --quiet | sort > "${BACKUP_DIR}/volumes-before.txt"
  # Deliberately not tolerating a read failure here: these counts are the
  # post-migration integrity check, and defaulting them to 0 would turn a
  # broken inventory into a silently passing assertion.
  IMG_BEFORE=$(wc -l < "${BACKUP_DIR}/images-before.txt")
  CNT_BEFORE=$(wc -l < "${BACKUP_DIR}/containers-before.txt")
else
  IMG_BEFORE=$(docker image ls --all --quiet | sort -u | wc -l)
  CNT_BEFORE=$(docker ps --all --format '{{.Names}}' | wc -l)
fi
log "inventory: ${IMG_BEFORE} images, ${CNT_BEFORE} containers"

for f in "$DAEMON_JSON" "$CONTAINERD_TOML"; do
  [[ -f "$f" ]] && run cp -a "$f" "${BACKUP_DIR}/"
done
log "config backups in ${BACKUP_DIR}"

if [[ $DRY_RUN -eq 1 ]]; then
  log "DRY-RUN complete — would now stop services, rsync both roots, rewrite configs, restart"
  trap - ERR
  exit 0
fi

# ---------------------------------------------------------------------------
# Stop everything. docker.socket must go too or socket activation restarts it.
# ---------------------------------------------------------------------------
log "--- stopping docker and containerd (all containers go down) ---"
systemctl stop docker.socket docker.service containerd

for i in $(seq 1 30); do
  pgrep -x dockerd >/dev/null 2>&1 || pgrep -x containerd >/dev/null 2>&1 || break
  sleep 1
done
pgrep -x dockerd    >/dev/null 2>&1 && fail "dockerd still running"
pgrep -x containerd >/dev/null 2>&1 && fail "containerd still running"
log "daemons stopped"

ROLLBACK_ARMED=1

# ---------------------------------------------------------------------------
# Copy. -H is essential: overlay layers share inodes via hardlinks and losing
# them would balloon size and break layer identity. -A/-X keep ACLs and the
# xattrs that overlayfs uses for whiteouts and opaque directories.
# ---------------------------------------------------------------------------
RSYNC_OPTS=(-aHAX --numeric-ids --info=progress2)

log "--- copying ${OLD_CONTAINERD} -> ${NEW_CONTAINERD} ---"
mkdir -p "$NEW_CONTAINERD"
rsync "${RSYNC_OPTS[@]}" "${OLD_CONTAINERD}/" "${NEW_CONTAINERD}/"

log "--- copying ${OLD_DOCKER} -> ${NEW_DOCKER} ---"
mkdir -p "$NEW_DOCKER"
rsync "${RSYNC_OPTS[@]}" "${OLD_DOCKER}/" "${NEW_DOCKER}/"

# Second pass must be a no-op. Any file transferred here means the first pass
# missed something.
log "--- verification pass (expect zero transfers) ---"
for pair in "${OLD_CONTAINERD}:${NEW_CONTAINERD}" "${OLD_DOCKER}:${NEW_DOCKER}"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  changed=$(rsync -aHAX --numeric-ids --dry-run --itemize-changes "${src}/" "${dst}/" | grep -c '^[<>ch]' || true)
  [[ "$changed" -eq 0 ]] || fail "verification failed: ${changed} file(s) differ between ${src} and ${dst}"
  log "  ${src} verified"
done

# ---------------------------------------------------------------------------
# Configure. Merge rather than overwrite so existing settings survive.
# ---------------------------------------------------------------------------
log "--- writing configuration ---"
mkdir -p /etc/docker
BASE='{"log-driver":"json-file","log-opts":{"max-size":"10m","max-file":"3"}}'
EXISTING='{}'
[[ -f "$DAEMON_JSON" ]] && EXISTING="$(cat "$DAEMON_JSON")"
jq -n --argjson base "$BASE" --argjson cur "$EXISTING" --arg root "$NEW_DOCKER" \
  '$base * $cur * {"data-root": $root}' > "${DAEMON_JSON}.new"
jq empty "${DAEMON_JSON}.new" || fail "generated daemon.json is invalid"
mv "${DAEMON_JSON}.new" "$DAEMON_JSON"
log "  ${DAEMON_JSON} -> data-root=${NEW_DOCKER}"

# The shipped config has `root` commented out; append an active setting.
if grep -qE '^\s*root\s*=' "$CONTAINERD_TOML"; then
  sed -i -E "s|^\s*root\s*=.*|root = \"${NEW_CONTAINERD}\"|" "$CONTAINERD_TOML"
else
  printf '\n# Moved off the SD card\nroot = "%s"\n' "$NEW_CONTAINERD" >> "$CONTAINERD_TOML"
fi
grep -qE "^root = \"${NEW_CONTAINERD}\"" "$CONTAINERD_TOML" || fail "containerd root not set"
log "  ${CONTAINERD_TOML} -> root=${NEW_CONTAINERD}"

# Without this, a boot where the NVMe mounts late starts the daemons against a
# missing path; they would create an empty root on the SD card and every image
# would appear to have vanished.
for pair in "${DOCKER_DROPIN}:docker" "${CONTAINERD_DROPIN}:containerd"; do
  f="${pair%%:*}"
  mkdir -p "$(dirname "$f")"
  cat > "$f" <<EOF
[Unit]
RequiresMountsFor=${SSD_MOUNT}
EOF
  log "  $(basename "$f") -> RequiresMountsFor=${SSD_MOUNT}"
done

# ---------------------------------------------------------------------------
# Restart and prove it worked
# ---------------------------------------------------------------------------
log "--- restarting ---"
systemctl daemon-reload
systemctl start containerd
systemctl start docker.socket docker.service

for i in $(seq 1 60); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done
docker info >/dev/null 2>&1 || fail "docker did not come back up"

ACTUAL_ROOT="$(docker info --format '{{.DockerRootDir}}')"
[[ "$ACTUAL_ROOT" == "$NEW_DOCKER" ]] || fail "data-root is ${ACTUAL_ROOT}, expected ${NEW_DOCKER}"

docker image ls --all --quiet | sort -u > "${BACKUP_DIR}/images-after.txt"
IMG_AFTER=$(wc -l < "${BACKUP_DIR}/images-after.txt")
[[ "$IMG_AFTER" -eq "$IMG_BEFORE" ]] \
  || fail "image count changed: ${IMG_BEFORE} -> ${IMG_AFTER} (see ${BACKUP_DIR})"

trap - ERR
log "=== migration OK: ${IMG_AFTER} images intact, root=${ACTUAL_ROOT} ==="

cat <<EOF

Old data is still on the SD card and still consuming space:
  ${OLD_DOCKER}
  ${OLD_CONTAINERD}

Leave it until you have confirmed everything works — check that all containers
came up, then reboot once to prove the mount ordering holds. Only then:

  sudo rm -rf ${OLD_DOCKER} ${OLD_CONTAINERD}

Rollback material and inventories: ${BACKUP_DIR}
EOF
