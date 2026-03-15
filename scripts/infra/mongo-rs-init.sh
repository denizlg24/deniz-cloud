#!/bin/bash
# MongoDB Replica Set + Sync User Initialization
# Runs via /docker-entrypoint-initdb.d/ on first start (empty data dir)
# At this point, mongod is running locally without auth enabled

set -e

echo "[mongo-rs-init] Initiating replica set rs0..."
mongosh --eval '
  rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: "mongodb:27017" }]
  });
'

echo "[mongo-rs-init] Waiting for primary election..."
sleep 3

echo "[mongo-rs-init] Creating read-only sync user..."
mongosh admin --eval "
  db.createUser({
    user: '${MONGO_SYNC_USER:-sync_reader}',
    pwd: '${MONGO_SYNC_PASSWORD:-changeme}',
    roles: [{ role: 'readAnyDatabase', db: 'admin' }]
  });
"

echo "[mongo-rs-init] Done"
