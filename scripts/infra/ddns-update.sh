#!/bin/bash

# DDNS updater for Cloudflare — updates A records when public IP changes.
# Intended to run as a cron job every 5 minutes:
#   */5 * * * * /path/to/ddns-update.sh >> /var/log/ddns-update.log 2>&1

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"
CACHE_FILE="/tmp/ddns-current-ip"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[$(date -Iseconds)] ERROR: .env file not found at $ENV_FILE"
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

: "${CF_API_TOKEN:?CF_API_TOKEN not set in .env}"
: "${CF_ZONE_ID:?CF_ZONE_ID not set in .env}"

SUBDOMAINS=("mongodb.denizlg24.com" "postgres.denizlg24.com")

CF_API="https://api.cloudflare.com/client/v4"

get_public_ip() {
  curl -4 -s --max-time 10 https://ifconfig.me || \
  curl -4 -s --max-time 10 https://api.ipify.org || \
  curl -4 -s --max-time 10 https://icanhazip.com
}

get_record_id() {
  local name="$1"
  curl -s -X GET \
    "${CF_API}/zones/${CF_ZONE_ID}/dns_records?type=A&name=${name}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

update_record() {
  local record_id="$1"
  local name="$2"
  local ip="$3"

  curl -s -X PUT \
    "${CF_API}/zones/${CF_ZONE_ID}/dns_records/${record_id}" \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"${name}\",\"content\":\"${ip}\",\"ttl\":300,\"proxied\":false}"
}

current_ip=$(get_public_ip)

if [[ -z "$current_ip" ]]; then
  echo "[$(date -Iseconds)] ERROR: could not determine public IP"
  exit 1
fi

cached_ip=""
if [[ -f "$CACHE_FILE" ]]; then
  cached_ip=$(cat "$CACHE_FILE")
fi

if [[ "$current_ip" == "$cached_ip" ]]; then
  exit 0
fi

echo "[$(date -Iseconds)] IP changed: ${cached_ip:-<none>} -> ${current_ip}"

for subdomain in "${SUBDOMAINS[@]}"; do
  record_id=$(get_record_id "$subdomain")

  if [[ -z "$record_id" ]]; then
    echo "[$(date -Iseconds)] WARNING: no A record found for ${subdomain}, skipping"
    continue
  fi

  result=$(update_record "$record_id" "$subdomain" "$current_ip")
  success=$(echo "$result" | grep -o '"success":true' || true)

  if [[ -n "$success" ]]; then
    echo "[$(date -Iseconds)] Updated ${subdomain} -> ${current_ip}"
  else
    echo "[$(date -Iseconds)] ERROR updating ${subdomain}: ${result}"
  fi
done

echo "$current_ip" > "$CACHE_FILE"
