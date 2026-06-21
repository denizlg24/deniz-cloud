#!/bin/sh
set -eu

ACL_FILE="${REDIS_ACL_FILE:-/data/users.acl}"
ACL_DIR="$(dirname "$ACL_FILE")"

: "${REDIS_PASSWORD:?REDIS_PASSWORD is required}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$ACL_DIR"
  find "$ACL_DIR" \! -user redis -exec chown redis:redis '{}' + || true
fi

umask 0077
mkdir -p "$ACL_DIR"

password_hash="$(printf '%s' "$REDIS_PASSWORD" | sha256sum | cut -d ' ' -f 1)"
default_rule="user default on #${password_hash} ~* &* +@all"
tmp_file="${ACL_FILE}.tmp"

if [ -f "$ACL_FILE" ]; then
  {
    printf '%s\n' "$default_rule"
    grep -v '^user default ' "$ACL_FILE" || true
  } > "$tmp_file"
else
  printf '%s\n' "$default_rule" > "$tmp_file"
fi

mv "$tmp_file" "$ACL_FILE"
chmod 600 "$ACL_FILE" || true

exec redis-server \
  --appendonly yes \
  --aclfile "$ACL_FILE" \
  --maxmemory "${REDIS_MAXMEMORY:-128mb}" \
  --maxmemory-policy allkeys-lru
