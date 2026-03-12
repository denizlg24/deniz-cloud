# Deniz Cloud

Self-hosted home server on Raspberry Pi 5 (4GB RAM). Cloud storage + exposed databases + admin panel.

## Architecture

- **Docker Compose** on RPi5 with Ubuntu Server (headless)
- **Storage**: NVMe SSD (~1TB) for hot data/DBs, USB HDD (3TB+) for cold/large files
- **Networking**: HTTP services via Cloudflare Tunnels; databases via port forwarding + DDNS

### Services

| Service | Port | Subdomain | Exposure |
|---------|------|-----------|----------|
| Storage API+UI (Bun/Hono) | 3001 | storage.denizlg24.com | CF Tunnel |
| Admin Panel (Bun/Hono) | 3002 | cloud.denizlg24.com | CF Tunnel |
| PostgreSQL 16 | 5433 | postgres.denizlg24.com | Port forward + DDNS |
| MongoDB 7 | 27018 | mongodb.denizlg24.com | Port forward + DDNS |
| Meilisearch | 7700 | search.denizlg24.com | CF Tunnel (tenant token auth, queries go direct) |
| Adminer | 8080 | internal only | via admin panel |
| Mongo UI | 8081 | internal only | via admin panel |
| Cloudflared | - | - | host service (not Docker) |

## Tech Stack

- **Runtime**: Bun (TypeScript)
- **API**: Hono (lightweight, Bun-native)
- **Frontend**: React + Vite (static SPA, no SSR — saves RAM)
- **ORM**: Drizzle (lightweight, no query engine binary)
- **Auth**: Custom (argon2, TOTP via otpauth, JWT sessions)
- **Search**: Meilisearch (sidecar replacing Atlas Search; synced via MongoDB change streams; multi-tenant via project/collection scoping + tenant tokens)
- **Containerization**: Docker Compose
- **Package manager**: bun (never npm)

## Monorepo Structure

```
deniz-cloud/
├── packages/
│   ├── shared/          # Auth logic, Drizzle schema, Meilisearch sync, types, utilities
│   ├── storage-api/     # Hono API (serves storage-ui build as static)
│   ├── storage-ui/      # React SPA (file browser, upload, previews)
│   ├── admin-api/       # Hono API (serves admin-ui build as static)
│   └── admin-ui/        # React SPA (dashboard, user mgmt, DB tools)
├── scripts/
│   ├── infra/ddns-update.sh   # DDNS updater (cron every 5m)
│   ├── backup.sh              # DB backup script
│   └── tiering.sh             # Storage tiering daemon
├── config/                    # cloudflared, meilisearch, mongo, postgres, nginx configs
├── certs/                     # TLS certs (gitignored)
└── docker-compose.yml
```

Each API serves its paired UI as static files = only 2 server processes total.

## Key Design Decisions

- **SPA over SSR**: No rendering overhead, critical on 4GB RAM
- **Hono over Express**: ~14KB vs ~200KB+, better Bun perf
- **Drizzle over Prisma**: No binary query engine, smaller footprint
- **Tiered storage**: Files transparently move between SSD/HDD based on access patterns, size, and SSD usage watermarks
- **Auth**: 2FA (TOTP) for all users; superuser adds recovery code as 3rd factor
- **Flat file paths + DB mapping**: Simpler for tiering than hierarchical paths
- **Meilisearch over ES/OpenSearch**: ~80-120MB RAM vs 500MB+; Atlas Search ($search) is Atlas-exclusive, not available on self-hosted MongoDB
- **Meilisearch multi-tenancy**: Admin-api manages projects/collections (index naming: `{projectId}_{collection}`), issues Meilisearch tenant tokens (scoped JWTs). Apps query Meilisearch directly with tokens — no proxy overhead, cryptographic scope enforcement

## Docker Memory Budget

Total ~1.45GB for containers, ~2.55GB for OS/cache/host services (cloudflared runs on host):
- Postgres: 200MB | MongoDB: 400MB | Storage: 300MB | Admin: 250MB
- Meilisearch: 120MB | Adminer: 100MB | Mongo UI: 80MB

## Current Progress

### Done
- [x] DDNS updater script + cron (`scripts/infra/ddns-update.sh`)
- [x] Router port forwarding
- [x] Pi setup — Docker + UFW (22, 5433, 27018)
- [x] Cloudflared on host (routes via CF dashboard)
- [x] Monorepo initialized — Bun workspaces, all 5 packages scaffolded, typechecks pass
- [x] Docker Compose — Postgres, MongoDB, Meilisearch, Adminer, mongo-express all running
- [x] Postgres + MongoDB config (auth, memory limits via command args)

### Next: Phase 1 (Foundation) — remaining
- [ ] Meilisearch container (CF Tunnel via search.denizlg24.com, SSD data dir)
- [ ] Shared package (types, Drizzle schema, Meilisearch sync utility)
- [ ] Search scoping API in admin-api (project/collection CRUD, tenant token issuance)
- [ ] Auth system (registration, login, TOTP, recovery codes, API keys)

### Future Phases
- Phase 2: Storage service (API, tiering engine, UI, previews, sharing)
- Phase 3: Admin panel (stats, user mgmt, DB tools)
- Phase 4: Backups, fail2ban, TLS certs, load testing
- Phase 5: S3 API, search, bulk download, mobile UI

## Conventions

- Use `bun` for all package management and scripts
- Strict TypeScript — no `any` or `unknown` casts to silence errors
- Self-documenting code over comments
- Passwords: argon2 | TOTP secrets: encrypted in PG | Recovery codes: hashed in PG
- All file tier moves are atomic: copy → verify checksum → update metadata → delete source
