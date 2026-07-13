#!/bin/bash

set -euo pipefail

readonly MONGO_80_IMAGE="${MONGO_80_IMAGE:-mongo:8.0.26}"
readonly MONGO_82_IMAGE="${MONGO_82_IMAGE:-mongo:8.2.11}"
readonly BACKUP_ROOT="${MONGO_UPGRADE_BACKUP_DIR:-./data/backups/mongodb-upgrade}"

compose() {
  docker compose "$@"
}

compose_80() {
  MONGO_IMAGE="$MONGO_80_IMAGE" MONGO_SEARCH_ENABLED=false docker compose "$@"
}

compose_82() {
  MONGO_IMAGE="$MONGO_82_IMAGE" MONGO_SEARCH_ENABLED=true docker compose "$@"
}

mongo_eval() {
  compose exec -T mongodb bash -lc \
    'mongosh --quiet --host localhost --port 27017 --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --eval "$1"' \
    -- "$1"
}

server_version() {
  mongo_eval 'db.version()'
}

fcv() {
  mongo_eval 'db.adminCommand({getParameter:1,featureCompatibilityVersion:1}).featureCompatibilityVersion.version'
}

require_consumers_stopped() {
  if [[ "${2:-}" != "--confirm-consumers-stopped" ]]; then
    echo "Refusing to continue without confirmation that external MongoDB consumers are stopped." >&2
    echo "Run: bash $0 $1 --confirm-consumers-stopped" >&2
    exit 2
  fi
}

preflight() {
  command -v docker >/dev/null
  docker compose version >/dev/null

  local kernel
  kernel="$(uname -r)"
  if [[ "$kernel" == 6.19* ]]; then
    echo "MongoDB 8.0+ is not supported on Linux kernel 6.19. Upgrade the kernel first." >&2
    exit 1
  fi

  compose exec -T mongodb mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null
}

stop_internal_consumers() {
  compose stop admin mongo-express >/dev/null
  compose stop mongot >/dev/null 2>&1 || true
}

backup_database() {
  mkdir -p "$BACKUP_ROOT"
  local stamp archive container_id
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  archive="mongodb-${stamp}.archive.gz"
  container_id="$(compose ps -q mongodb)"

  echo "Creating full logical backup: $BACKUP_ROOT/$archive"
  compose exec -T mongodb bash -lc \
    'mongodump --archive="/tmp/'"$archive"'" --gzip --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin'
  docker cp "$container_id:/tmp/$archive" "$BACKUP_ROOT/$archive" >/dev/null
  compose exec -T mongodb rm -f "/tmp/$archive"
  test -s "$BACKUP_ROOT/$archive"
  echo "Backup verified: $BACKUP_ROOT/$archive"
}

wait_for_mongodb() {
  local runner="$1"
  for attempt in $(seq 1 60); do
    if "$runner" exec -T mongodb mongosh --quiet --eval 'quit(db.adminCommand({ping:1}).ok === 1 ? 0 : 1)' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "MongoDB did not become ready" >&2
  return 1
}

to_80() {
  require_consumers_stopped "to-8.0" "${1:-}"
  preflight
  local version current_fcv
  version="$(server_version)"
  current_fcv="$(fcv)"
  if [[ "$version" != 7.* || "$current_fcv" != "7.0" ]]; then
    echo "Expected MongoDB 7.x with FCV 7.0; found server $version, FCV $current_fcv." >&2
    exit 1
  fi

  stop_internal_consumers
  backup_database
  compose_80 pull mongodb mongo-init
  compose_80 up -d --no-deps --force-recreate mongodb
  wait_for_mongodb compose_80
  compose_80 up --no-deps mongo-init

  version="$(server_version)"
  current_fcv="$(fcv)"
  if [[ "$version" != 8.0.* || "$current_fcv" != "7.0" ]]; then
    echo "Unexpected post-upgrade state: server $version, FCV $current_fcv." >&2
    exit 1
  fi

  compose_80 up -d --no-deps admin mongo-express
  echo "MongoDB is on $version with FCV 7.0. Run application smoke tests and allow a burn-in period."
  echo "Until finalization, include MONGO_IMAGE=$MONGO_80_IMAGE MONGO_SEARCH_ENABLED=false in Compose commands."
}

to_82() {
  require_consumers_stopped "to-8.2" "${1:-}"
  preflight
  local version current_fcv
  version="$(server_version)"
  current_fcv="$(fcv)"
  if [[ "$version" != 8.0.* ]]; then
    echo "Expected MongoDB 8.0.x; found $version. Complete the 8.0 stage first." >&2
    exit 1
  fi

  stop_internal_consumers
  backup_database

  if [[ "$current_fcv" != "8.0" ]]; then
    echo "Enabling FCV 8.0..."
    mongo_eval 'db.adminCommand({setFeatureCompatibilityVersion:"8.0",confirm:true})'
  fi

  compose_82 pull mongodb mongo-init mongot
  compose_82 up -d --no-deps --force-recreate mongodb
  wait_for_mongodb compose_82
  compose_82 up --no-deps mongo-init
  compose_82 up -d mongot
  compose_82 up -d --no-deps admin mongo-express

  version="$(server_version)"
  current_fcv="$(fcv)"
  if [[ "$version" != 8.2.* || "$current_fcv" != "8.0" ]]; then
    echo "Unexpected final state: server $version, FCV $current_fcv." >&2
    exit 1
  fi

  echo "MongoDB is on $version with FCV 8.0; mongot is starting."
  echo "After the 8.2 burn-in and backups are verified, run: bash $0 enable-8.2-features"
}

enable_82_features() {
  preflight
  local version
  version="$(server_version)"
  if [[ "$version" != 8.2.* ]]; then
    echo "Expected MongoDB 8.2.x; found $version." >&2
    exit 1
  fi
  mongo_eval 'db.adminCommand({setFeatureCompatibilityVersion:"8.2",confirm:true})'
  echo "FCV 8.2 enabled. Binary downgrade now requires MongoDB's documented downgrade procedure or restore."
}

status() {
  preflight
  echo "Server: $(server_version)"
  echo "FCV:    $(fcv)"
  compose ps mongodb mongo-init mongot
}

case "${1:-}" in
  status) status ;;
  to-8.0) to_80 "${2:-}" ;;
  to-8.2) to_82 "${2:-}" ;;
  enable-8.2-features) enable_82_features ;;
  *)
    echo "Usage: $0 {status|to-8.0 --confirm-consumers-stopped|to-8.2 --confirm-consumers-stopped|enable-8.2-features}" >&2
    exit 2
    ;;
esac
