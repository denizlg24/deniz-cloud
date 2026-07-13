#!/bin/bash

set -euo pipefail

cp /etc/mongo/replica-keyfile /tmp/replica-keyfile
chmod 400 /tmp/replica-keyfile
chown 999:999 /tmp/replica-keyfile

args=(
  --wiredTigerCacheSizeGB "${MONGO_WIREDTIGER_CACHE_GB:-0.5}"
  --replSet rs0
  --keyFile /tmp/replica-keyfile
  --quiet
  --setParameter diagnosticDataCollectionEnabled=false
)

if [[ "${MONGO_SEARCH_ENABLED:-true}" == "true" ]]; then
  args+=(
    --setParameter searchIndexManagementHostAndPort=mongot:27028
    --setParameter mongotHost=mongot:27028
    --setParameter skipAuthenticationToSearchIndexManagementServer=false
    --setParameter useGrpcForSearch=true
    --setParameter searchTLSMode=disabled
  )
fi

exec docker-entrypoint.sh mongod "${args[@]}"
