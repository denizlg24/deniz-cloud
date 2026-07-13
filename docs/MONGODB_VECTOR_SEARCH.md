# MongoDB 8.2 and Vector Search

Deniz Cloud runs MongoDB Community 8.2 with the self-managed MongoDB Search process (`mongot`). This adds the `$vectorSearch` aggregation stage without replacing Meilisearch: Meilisearch remains the project-scoped full-text/typo-tolerant search service and its change-stream sync continues unchanged.

## Components

- `mongodb`: pinned to `mongo:8.2.11`, single-node replica set `rs0`.
- `mongot`: pinned to `mongodb/mongodb-community-search:1.70.1`, reachable only on the internal Docker network.
- `mongo-init`: maintains the `sync_reader` and `mongot_search` users and writes the latter's password into a read-only named volume.
- Admin API: manages vector indexes only inside a project's provisioned MongoDB database.
- Admin UI: shows health, build status, quota, create, and delete controls.

MongoDB and `mongot` have no Docker memory limit. `mongot` JVM flags are optional through `MONGOT_JVM_FLAGS`; leave this empty to use its defaults. Monitor host memory and `http://mongot:9946/metrics` from the internal network.

## Required environment

Set a separate random `MONGOT_PASSWORD` before migration. Keep the generated `config/mongo/replica-keyfile` unchanged because changing it would break replica-set authentication.

```dotenv
MONGO_IMAGE=mongo:8.2.11
MONGOT_IMAGE=mongodb/mongodb-community-search:1.70.1
MONGOT_PASSWORD=<random-long-password>
MONGOT_DATA_DIR=/mnt/ssd/mongot
MONGOT_JVM_FLAGS=
MONGOT_MAX_INDEXES_PER_PROJECT=5
```

## Safe upgrade procedure

MongoDB does not support a direct 7.x to 8.2 binary upgrade. The migration script enforces 7.x → 8.0 → 8.2, makes a complete compressed `mongodump` before each binary change, and leaves FCV behind the binary version for a burn-in period.

This is a single-node replica set, so each binary change causes downtime. Stop every external Next.js/Mongoose consumer before each stage; the script stops the internal admin sync worker and mongo-express but cannot stop external applications.

1. Confirm the existing deployment is healthy and record its state:

   ```bash
   bash scripts/migrate-mongodb-8.2.sh status
   ```

2. Stop external consumers, then install 8.0 while retaining FCV 7.0:

   ```bash
   bash scripts/migrate-mongodb-8.2.sh to-8.0 --confirm-consumers-stopped
   ```

3. Restart consumers and smoke-test normal reads/writes, Mongoose indexes, change-stream synchronization, and Meilisearch search. Allow a burn-in period. During this interval, use `MONGO_IMAGE=mongo:8.0.26 MONGO_SEARCH_ENABLED=false` with manual Compose commands so the default 8.2 image is not applied early.

4. Stop external consumers again, then move to 8.2 and start `mongot`:

   ```bash
   bash scripts/migrate-mongodb-8.2.sh to-8.2 --confirm-consumers-stopped
   docker compose ps mongodb mongo-init mongot meilisearch admin
   docker compose logs --tail=100 mongodb mongot
   ```

5. Restart consumers and verify reads, writes, change streams, Meilisearch, and a disposable vector index/query. Keep FCV at 8.0 during this burn-in.

6. Only after backups and the burn-in are accepted, enable 8.2 features:

   ```bash
   bash scripts/migrate-mongodb-8.2.sh enable-8.2-features
   ```

The preflight rejects Linux kernel 6.19 because MongoDB 8.0+ has a documented incompatibility with that kernel.

## Backups and rollback

Upgrade archives are written to `data/backups/mongodb-upgrade` by default. Confirm each archive is non-empty and copy it off the Pi before changing FCV.

- Before enabling FCV 8.0, an 8.0 failure can normally be rolled back to the prior 7.x binary after stopping writes.
- Once FCV has advanced, do not swap the image backward. Restore the last archive into a clean data directory using the intended older server version.
- `mongot` index files are derived data. Back up MongoDB itself; after restore, recreate vector indexes and let `mongot` rebuild them.
- Never point two MongoDB major versions at the same data directory concurrently.

Example restore into an intentionally empty MongoDB instance:

```bash
mongorestore --archive=mongodb-YYYYMMDDTHHMMSSZ.archive.gz --gzip \
  --username "$MONGO_INITDB_ROOT_USERNAME" \
  --password "$MONGO_INITDB_ROOT_PASSWORD" \
  --authenticationDatabase admin
```

## Index management

Provision MongoDB for a project, open that project in the admin UI, and use **MongoDB Vector Search**. Each index accepts:

- an existing collection;
- index and embedding field names;
- 1–4096 dimensions, which must match the embedding model exactly;
- `cosine`, `dotProduct`, or `euclidean` similarity;
- optional scalar/binary quantization;
- up to five filter fields.

The project database user has `dbOwner`, which includes the permissions needed to query its indexes directly. Example with Mongoose:

```ts
const results = await Model.aggregate([
  {
    $vectorSearch: {
      index: "vector_index",
      path: "embedding",
      queryVector: embedding,
      numCandidates: 100,
      limit: 10,
      filter: { tenantId },
    },
  },
]);
```

The vector field must contain numeric arrays with the configured dimensions. Use `$vectorSearch` as the first aggregation stage. Index creation is asynchronous; wait until the UI shows `READY` before serving queries.

## Operations

- Readiness: `docker compose exec mongot curl -fsS http://mongot:8080/ready`
- Health: `docker compose exec mongot curl -fsS http://mongot:8080/health`
- Metrics: port `9946` on the internal network
- Logs: `docker compose logs -f mongodb mongot`
- Index data: `${MONGOT_DATA_DIR}` (defaults to `./data/mongot`)
- Project quota: `${MONGOT_MAX_INDEXES_PER_PROJECT}` (defaults to 5)

Every search index consumes resources and an additional synchronization stream. Keep the project quota conservative on the Raspberry Pi and monitor host memory, disk, index build time, and query latency. An unavailable `mongot` affects vector search only; regular MongoDB operations and Meilisearch continue to work.

## Primary references

- [MongoDB Search Docker deployment](https://www.mongodb.com/docs/search/self-managed/current/installation/docker/)
- [Self-managed Search compatibility](https://www.mongodb.com/docs/search/self-managed/current/deployment/compatibility-requirements/)
- [Upgrade a replica set to MongoDB 8.0](https://www.mongodb.com/docs/manual/release-notes/8.0-upgrade-replica-set/)
- [Upgrade MongoDB 8.0 to 8.2](https://www.mongodb.com/docs/v8.2/release-notes/8.2-upgrade/)
- [`$vectorSearch`](https://www.mongodb.com/docs/v8.2/reference/operator/aggregation/vectorsearch/)
