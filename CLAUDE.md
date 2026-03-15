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
- **Auth**: Custom (argon2id via Bun.password, TOTP via otpauth, JWT via jose, AES-256-GCM for TOTP secret encryption)
- **Search**: Meilisearch (sidecar replacing Atlas Search; synced via MongoDB change streams; multi-tenant via project/collection scoping + tenant tokens)
- **Containerization**: Docker Compose
- **Package manager**: bun (never npm)

## Monorepo Structure

```
deniz-cloud/
├── packages/
│   ├── shared/                # Shared library (subpath exports)
│   │   ├── src/
│   │   │   ├── auth/          # Crypto primitives (password, TOTP, JWT, recovery codes)
│   │   │   ├── db/            # Drizzle schema (6 tables) + postgres.js connection
│   │   │   ├── search/        # Meilisearch client, index management, tenant tokens
│   │   │   ├── services/      # Auth service layer (register, login, sessions, API keys, user CRUD)
│   │   │   ├── middleware/     # Hono auth middleware (session + API key, role guard, rate limiting)
│   │   │   ├── types/         # API-facing types (SafeUser, ApiResponse, etc.)
│   │   │   └── env.ts         # Environment variable helpers
│   │   └── drizzle.config.ts
│   ├── storage-api/           # Hono API (serves storage-ui build as static)
│   ├── storage-ui/            # React SPA (file browser, upload, previews)
│   ├── admin-api/             # Hono API (serves admin-ui build as static)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.ts    # Login (password+TOTP), logout, me
│   │   │   │   ├── users.ts   # User CRUD (list, create pending, delete, reset MFA)
│   │   │   │   ├── stats.ts   # System stats (CPU, RAM, disk) + storage stats
│   │   │   │   └── search.ts  # Search project/collection CRUD, tenant tokens
│   │   │   ├── config.ts      # Env config
│   │   │   ├── index.ts       # App wiring, error handler
│   │   │   └── seed.ts        # Interactive superuser setup CLI
│   │   └── .env.example
│   └── admin-ui/              # React SPA (dashboard, user mgmt, search mgmt)
├── scripts/
│   ├── infra/ddns-update.sh   # DDNS updater (cron every 5m)
│   ├── backup.sh              # DB backup script
│   └── tiering.sh             # Storage tiering daemon
├── config/                    # cloudflared, meilisearch, mongo, postgres, nginx configs
├── certs/                     # TLS certs (gitignored)
└── docker-compose.yml
```

Each API serves its paired UI as static files = only 2 server processes total.

### Shared Package Exports

| Import path | Contents |
|-------------|----------|
| `@deniz-cloud/shared/db` | Drizzle schema, relations, inferred types, `createDb()` |
| `@deniz-cloud/shared/auth` | `hashPassword`, `verifyPassword`, TOTP, JWT sign/verify, recovery codes |
| `@deniz-cloud/shared/services` | `registerUser`, `loginWithPassword`, `createSession`, `validateSession`, `createApiKey`, `listApiKeys`, `createProject`, `listProjects`, `getProject`, `deleteProject`, `createPendingUser`, `completeSignup`, `listUsers`, `deleteUser`, `resetUserMfa`, etc. |
| `@deniz-cloud/shared/middleware` | `auth()` (Bearer + API key), `requireRole()`, `requireScope()`, `rateLimit()`, `AuthVariables` type |
| `@deniz-cloud/shared/search` | `createMeiliClient`, index CRUD, `generateProjectToken` |
| `@deniz-cloud/shared/types` | `SafeUser`, `SafeProject`, `SafeApiKey`, `ApiKeyScope`, `API_KEY_SCOPES`, `ApiResponse<T>`, `PaginatedResponse<T>`, etc. |
| `@deniz-cloud/shared/env` | `requiredEnv()`, `optionalEnv()` |

## Key Design Decisions

- **SPA over SSR**: No rendering overhead, critical on 4GB RAM
- **Hono over Express**: ~14KB vs ~200KB+, better Bun perf
- **Drizzle over Prisma**: No binary query engine, smaller footprint
- **Tiered storage**: Files transparently move between SSD/HDD based on access patterns, size, and SSD usage watermarks
- **Auth**: 2FA (TOTP) for all users; recovery codes as TOTP fallback for account recovery
- **Flat file paths + DB mapping**: Simpler for tiering than hierarchical paths
- **Meilisearch over ES/OpenSearch**: ~80-120MB RAM vs 500MB+; Atlas Search ($search) is Atlas-exclusive, not available on self-hosted MongoDB
- **Meilisearch multi-tenancy**: Admin-api manages projects/collections (index naming: `{projectId}_{collection}`), issues Meilisearch tenant tokens (scoped JWTs). Apps query Meilisearch directly with tokens — no proxy overhead, cryptographic scope enforcement
- **Pending user signup**: Admin creates username → user completes signup on storage-ui (email, password, mandatory TOTP). Status enum (`pending` | `active`), `passwordHash` nullable until signup completed
- **Rate limiting**: In-memory per-IP sliding window (`CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP`). Applied to login (10/15min) and complete-signup (5/15min). Generic errors on signup to prevent username enumeration
- **Share links**: Stateless HMAC-signed tokens (fileId:expiresAt), no DB state. Configurable expiration (30m, 1d, 7d, 30d, never)
- **Projects**: Unified entity for programmatic access — each project has a private storage folder, scoped API keys (with rotation support), and will have MongoDB→Meilisearch collection sync. API keys carry `scopes` (jsonb) enforced via `requireScope()` middleware; session auth bypasses scopes (full access)

## Docker Memory Budget

Total ~1.45GB for containers, ~2.55GB for OS/cache/host services (cloudflared runs on host):
- Postgres: 200MB | MongoDB: 400MB | Storage: 300MB | Admin: 250MB
- Meilisearch: 120MB | Adminer: 100MB | Mongo UI: 80MB

## Current Progress

### Phase 1: Foundation — COMPLETE
- [x] DDNS updater script + cron (`scripts/infra/ddns-update.sh`)
- [x] Router port forwarding
- [x] Pi setup — Docker + UFW (22, 5433, 27018)
- [x] Cloudflared on host (routes via CF dashboard)
- [x] Monorepo initialized — Bun workspaces, all 5 packages scaffolded, typechecks pass
- [x] Docker Compose — Postgres, MongoDB, Meilisearch, Adminer, mongo-express all running
- [x] Postgres + MongoDB config (auth, memory limits via command args)
- [x] Meilisearch container config (CF Tunnel via search.denizlg24.com, SSD data dir)
- [x] Shared package — Drizzle schema (6 tables), auth primitives, services, middleware, search utils, types, env helpers
- [x] Auth system — registration, login (password+TOTP), sessions (JWT+DB), API keys, recovery codes, Hono middleware
- [x] Search scoping API in admin-api — project/collection CRUD, tenant token issuance (7 endpoints)
- [x] Admin-api auth routes — login, logout, me
- [x] Superuser seed CLI (`bun run seed:admin` in admin-api)
- [x] Unit tests (40 passing) — password, TOTP, JWT, recovery codes, search indexes, env

### Phase 2: Storage Service — COMPLETE
- [x] Storage API (Hono): TUS resumable upload, download (with HTTP Range support), delete, rename, move, folder CRUD
- [x] File metadata in Postgres via Drizzle
- [x] Storage API auth routes — login (password+TOTP), logout, me (cookie-based sessions)
- [x] Storage API seed CLI (`bun run seed:storage`)
- [x] Cookie middleware in shared — `setCookieToken()` / `clearCookieToken()` for httpOnly cookie auth
- [x] Auth middleware updated — reads JWT from `Authorization` header OR `token` cookie
- [x] Admin API login restricted to superusers only (403 for non-superusers)
- [x] Storage web UI (React + Vite + shadcn/ui + Tailwind): login, signup flow, MFA setup, file browser (grid/list), folder navigation, breadcrumbs, create/rename/delete dialogs, TUS upload with drag-and-drop + progress, file preview (images, video, audio, PDF, code, text, markdown), folder caching
- [x] Shareable public links — HMAC-signed stateless tokens with configurable expiration, share dialog in UI
- [x] Pending user signup flow — admin creates username → user completes on storage-ui (email, password, mandatory TOTP)
- [x] MFA enforcement — auth guard redirects to `/setup-mfa` if TOTP not enabled
- [x] Rate limiting on login (10/15min) and complete-signup (5/15min) per IP
- [x] Username enumeration prevention — generic error responses on complete-signup
- [x] OpenAPI specs updated for storage-api and admin-api
- [x] Docker Compose healthcheck fix
- [ ] Tiering engine: SSD/HDD migration logic, on-access promotion
- [ ] Tiering cron job

### Phase 3: Admin Panel — COMPLETE
- [x] Admin API: system stats (CPU, RAM, disk via /proc with node:os fallback), storage stats (file counts, sizes, tiers)
- [x] Admin API: user management (list, create pending, delete, reset MFA) — superuser only
- [x] Admin web UI (React + Vite + shadcn/ui + Tailwind): dashboard with radial gauge charts, user management table, responsive sidebar layout
- [x] Rate limiting on admin login (10/15min) per IP
- [x] Docker bind mounts (`/proc:/host/proc:ro`, `/sys:/host/sys:ro`) for host-level stats
- [x] Docker build optimization — cache mounts for bun install, sequential stage execution
- [x] Cross-platform stats fallback (node:os for CPU/RAM on non-Linux, empty disk on Windows)
- [x] BusyBox-compatible disk parsing (df -kP with KB→bytes conversion, device de-duplication)
- [ ] Integrate Adminer and Mongo UI (embedded, internal-only)

### Phase 4: Projects & API Keys — COMPLETE
- [x] `projects` table (name, slug, description, ownerId, storageFolderId, meiliApiKeyUid, meiliApiKey)
- [x] `api_keys` extended with `projectId` (FK projects) and `scopes` (jsonb)
- [x] Project service layer (CRUD, auto-creates private storage folder)
- [x] API key service updates (create with scopes/expiration, list by project, validate returns project+scopes)
- [x] Auth middleware updated — propagates `project` and `scopes` on API key auth
- [x] `requireScope()` middleware — enforces scoped access, session auth bypasses (full access)
- [x] Scope system: `storage:read`, `storage:write`, `storage:delete`, `search:read`, `search:write`, `search:manage`
- [x] Admin API: project CRUD + nested API key CRUD (7 endpoints under `/api/projects`)
- [x] Admin UI: projects page with drill-down project detail, API key management (create with scope picker, revoke, copy-once key display)
- [x] SQL migrations for projects table, api_keys columns, meili fields
- [x] Storage API: project folder isolation — `checkProjectScope()` utility enforces path prefix + scope on every route handler; API key auth replaces ownership checks with project path boundary; `GET /roots` returns project folder for API key auth
- [x] Search migrated into project model — `projects` table has nullable `meili_api_key_uid`/`meili_api_key`; search collection CRUD + tenant token endpoints under `/api/projects/:id/search-collections` and `/api/projects/:id/search-token`; auto-creates Meilisearch API key on first collection; old `/api/search` routes kept but deprecated

### Phase 5: MongoDB ↔ Meilisearch Sync — PLANNED
- See `docs/phase3-mongodb-meilisearch-sync.md` for full design
- `project_collections` table linking MongoDB collections to Meilisearch indexes
- Change stream-based incremental sync with resume tokens
- Embedded sync worker in admin-api (RAM-constrained)
- Field mapping config (searchable, filterable, sortable attributes)
- Admin UI: collection management in project detail view

### Future Phases
- Phase 6: Backups, fail2ban, TLS certs, load testing
- Phase 7: S3 API, bulk download, mobile UI, tiering engine

## Conventions

- Use `bun` for all package management and scripts
- Strict TypeScript — no `any` or `unknown` casts to silence errors
- Self-documenting code over comments
- Passwords: argon2 | TOTP secrets: encrypted in PG | Recovery codes: hashed in PG
- All file tier moves are atomic: copy → verify checksum → update metadata → delete source
