# Deniz Cloud

Self-hosted home server running on a Raspberry Pi 5 (4GB RAM) with tiered storage (NVMe SSD + USB HDD).

## What it does

- **Cloud storage** — Google Drive-like web UI for my family, with file previews, folder organization, and shareable links. Files are transparently tiered between SSD (hot) and HDD (cold) based on access patterns and size.
- **S3-compatible storage** — SigV4-authenticated bucket and object access at `/v2`, compatible with SDKs that support custom path-style endpoints. See [S3 API setup](./docs/S3_API.md).
- **MongoDB, PostgreSQL & Redis** — Databases/caching for personal projects, exposed as raw TCP connections over port forwarding with dynamic DNS. MongoDB 8.2 includes self-managed vector search through `mongot`.
- **Admin panel** — Dashboard for managing users, monitoring storage health, and accessing lightweight DB tools.

## How it's exposed

- `storage.denizlg24.com` — File storage (Cloudflare Tunnel)
- `cloud.denizlg24.com` — Admin panel (Cloudflare Tunnel)
- `search.denizlg24.com` — Meilisearch (full-text and typo-tolerant search)
- `mongodb.denizlg24.com` — MongoDB (port forward + DDNS)
- `postgres.denizlg24.com` — PostgreSQL (port forward + DDNS)
- `redis.denizlg24.com` — Redis (port forward + DDNS)

## Stack

Bun, Hono, React, Drizzle, PostgreSQL, MongoDB, Redis, Docker Compose, Cloudflared.

See [PLAN.md](./PLAN.md) for the full architecture and implementation plan.

See [MongoDB 8.2 and Vector Search](./docs/MONGODB_VECTOR_SEARCH.md) for the staged upgrade, rollback, index management, and Mongoose usage guide. Meilisearch remains available as a separate search path; its migration guide is [SEARCH_MIGRATION.md](./docs/SEARCH_MIGRATION.md).
