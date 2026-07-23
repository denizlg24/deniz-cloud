#!/bin/bash

# Adds the USB-attached HDD to /etc/fstab so it remounts at boot.
#
# Without this, /mnt/hdd is a transient mount. After a reboot the path still
# exists as a plain directory on the SD card, so BACKUP_DIR and
# HDD_STORAGE_PATH silently write to the root filesystem instead.
#
# Mount options chosen for a USB device:
#   nofail                      boot continues if the drive is absent
#   x-systemd.device-timeout=30 don't stall boot 90s waiting for a missing disk
#   noatime                     fewer writes
#
# Usage: sudo ./mount-hdd-persistent.sh [--check]

set -euo pipefail

HDD_UUID="5fdcf9ce-a062-4118-8402-9a438297e54b"
HDD_MOUNT="/mnt/hdd"
HDD_OPTS="defaults,noatime,nofail,x-systemd.device-timeout=30"
FSTAB="/etc/fstab"

CHECK_ONLY=0
[[ "${1:-}" == "--check" ]] && CHECK_ONLY=1

log() { echo "[$(date -Iseconds)] $*"; }
fail() { log "ERROR: $*"; exit 1; }

[[ $EUID -eq 0 ]] || fail "must run as root"

# Confirm the UUID still resolves — USB enclosures can change device names,
# which is exactly why we mount by UUID rather than /dev/sda1.
[[ -e "/dev/disk/by-uuid/${HDD_UUID}" ]] \
  || fail "no device with UUID ${HDD_UUID}; is the drive connected?"

if grep -q "${HDD_UUID}" "$FSTAB"; then
  log "fstab already has an entry for ${HDD_UUID} — nothing to do"
  exit 0
fi

ENTRY="UUID=${HDD_UUID}  ${HDD_MOUNT}  ext4  ${HDD_OPTS}  0  2"

if [[ $CHECK_ONLY -eq 1 ]]; then
  log "would append to ${FSTAB}:"
  echo "  ${ENTRY}"
  exit 0
fi

BACKUP="${FSTAB}.bak-$(date +%Y%m%d-%H%M%S)"
cp -a "$FSTAB" "$BACKUP"
log "backed up ${FSTAB} -> ${BACKUP}"

printf '\n# USB HDD — cold storage tier and backup target\n%s\n' "$ENTRY" >> "$FSTAB"
log "appended entry for ${HDD_MOUNT}"

# A malformed fstab can block boot, so validate before we ever reboot.
if ! findmnt --verify --verbose >/dev/null 2>&1; then
  log "fstab failed validation — restoring backup"
  cp -a "$BACKUP" "$FSTAB"
  fail "fstab was reverted; no changes kept"
fi
log "fstab validates"

# Prove the entry actually works now rather than discovering it at next boot.
systemctl daemon-reload
if mountpoint -q "$HDD_MOUNT"; then
  log "${HDD_MOUNT} already mounted; remounting via fstab to confirm the entry"
  umount "$HDD_MOUNT" || fail "could not unmount ${HDD_MOUNT} (in use?) — entry is in fstab and will apply at boot"
fi
mount "$HDD_MOUNT" || fail "mount ${HDD_MOUNT} failed — check the entry in ${FSTAB}"

log "OK: ${HDD_MOUNT} mounted from fstab"
findmnt -no SOURCE,TARGET,FSTYPE,OPTIONS "$HDD_MOUNT"
