# Deniz Cloud — Self-Hosted Home Server

## 1. Project Overview

A self-hosted home server running on a Raspberry Pi 5 (4GB RAM) that provides:

- **Cloud storage** with a Google Drive-like web UI and optional S3-compatible API
- **MongoDB** and **PostgreSQL** exposed as raw TCP connections for personal projects
- **Admin panel** for system health, storage metadata, and lightweight DB management
- **Tiered storage** — SSD for hot files/databases, HDD for cold/large files, transparent to users

All HTTP services are exposed through **Cloudflare Tunnels**. Database services are exposed via **port forwarding** with **dynamic DNS** updates through the Cloudflare API.

---

## 2. Hardware

| Component | Spec |
|---|---|
| Board | Raspberry Pi 5 |
| RAM | 4GB |
| OS | Ubuntu Server (headless, no desktop) |
| SSD (NVMe via expansion hat) | ~1TB — databases, hot files |
| HDD (USB 3.0) | 3TB+ — cold/large files |

### Drive Layout

```
/mnt/ssd/
├── postgres/        # PostgreSQL data directory
├── mongo/           # MongoDB data directory
├── meilisearch/     # Meilisearch data directory
├── storage/hot/     # Frequently accessed files
└── backups/         # DB snapshot staging

/mnt/hdd/
├── storage/cold/    # Infrequently accessed / large files
└── backups/         # DB snapshot archive
```

---

## 3. Architecture

```
                        ┌────────────────────────────────────────────────────────────────────┐
                        │          Cloudflare                                                │
                        │                                                                    │
                        │  storage.denizlg24.com ──► Tunnel ──► ──► :3001 (Storage UI + API) │
                        │  cloud.denizlg24.com   ──► Tunnel ──► ──► :3002 (Admin Panel)      │
                        │  search.denizlg24.com  ──► Tunnel ──► ──► :7700 (Meilisearch)      │
                        │                                                                    │ 
                        │  mongodb.denizlg24.com ──► DNS A ───► ──► :27018 (MongoDB)         │
                        │  postgres.denizlg24.com──► DNS A ───► ──► :5433  (PostgreSQL)      │
                        └────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
                        ┌──────────────────────────────────────┐
                        │           Raspberry Pi 5             │
                        │                                      │
                        │  ┌─────────────────────────────────┐ │
                        │  │        Docker Compose           │ │
                        │  │                                 │ │
                        │  │  ┌─────────┐  ┌──────────────┐  │ │
                        │  │  │ MongoDB │  │  PostgreSQL  │  │ │
                        │  │  │ :27018  │  │   :5433      │  │ │
                        │  │  └─────────┘  └──────────────┘  │ │
                        │  │                                 │ │
                        │  │  ┌──────────────────────────┐   │ │
                        │  │  │  Storage Service (Bun)   │   │ │
                        │  │  │  API + Web UI  :3001     │   │ │
                        │  │  └──────────────────────────┘   │ │
                        │  │                                 │ │
                        │  │  ┌──────────────────────────┐   │ │
                        │  │  │  Admin Panel (Bun)       │   │ │
                        │  │  │  Web UI + API  :3002     │   │ │
                        │  │  └──────────────────────────┘   │ │
                        │  │                                 │ │
                        │  │  ┌───────────┐  ┌────────────┐  │ │
                        │  │  │ Adminer   │  │ Mongo UI   │  │ │
                        │  │  │ :8080     │  │ :8081      │  │ │
                        │  │  └───────────┘  └────────────┘  │ │
                        │  │                                 │ │
                        │  │  ┌──────────────────────────┐   │ │
                        │  │  │  Meilisearch             │   │ │
                        │  │  │  (Search sidecar) :7700  │   │ │
                        │  │  └──────────────────────────┘   │ │
                        │  │                                 │ │
                        │  └─────────────────────────────────┘ │
                        │                                      │
                        │  ┌─────────────────────────────────┐ │
                        │  │  Host Services                  │ │
                        │  │  - Cloudflared (tunnel daemon)  │ │
                        │  │  - DDNS updater (cron)          │ │
                        │  │  - Health monitor (Go)          │ │
                        │  │  - Tiering daemon (cron/service)│ │
                        │  │  - DB backup (cron)             │ │
                        │  └─────────────────────────────────┘ │
                        │                                      │
                        │  ┌────────────┐  ┌────────────────┐  │
                        │  │  /mnt/ssd  │  │   /mnt/hdd     │  │
                        │  │  (NVMe)    │  │   (USB 3.0)    │  │
                        │  └────────────┘  └────────────────┘  │
                        └──────────────────────────────────────┘
```

---

## 4. Services Breakdown

### 4.1 Storage Service — `storage.denizlg24.com` (Port 3001)

A combined API + Web UI server running on Bun (single process to save RAM).

#### Web UI (React SPA served by the same Bun server)

- Google Drive-like interface
  - Folder tree navigation (sidebar)
  - File grid/list view with sorting
  - Drag-and-drop upload
  - Multi-file selection, bulk actions (download, delete, move)
  - File previews: images, PDFs, videos (streaming), code files (syntax highlighted)
  - Shareable public links (read-only, optionally password-protected, optionally expiring)
  - Confirmation dialog on delete (permanent, no trash)

#### API

- RESTful API for all file operations
- Optional S3-compatible subset (GetObject, PutObject, ListBucket, DeleteObject) — lower priority, can be added later
- Endpoints:
  - `POST /api/files/upload` — upload file(s)
  - `GET /api/files/:id/download` — download file
  - `GET /api/files/:id/stream` — stream (video/audio)
  - `GET /api/files/:id/preview` — preview/thumbnail
  - `DELETE /api/files/:id` — delete file (permanent)
  - `PATCH /api/files/:id` — rename, move
  - `GET /api/folders/:id` — list folder contents
  - `POST /api/folders` — create folder
  - `POST /api/share` — generate shareable link
  - `GET /api/storage/stats` — storage usage stats

#### Metadata Database

- Uses the PostgreSQL instance for file metadata:
  - File ID, name, path, size, MIME type, checksum
  - Current storage tier (SSD/HDD)
  - Timestamps: created, last accessed, last modified, last tier change
  - Owner (user ID), permissions
  - Share link data
- Folders are also stored as rows (type: folder) with parent references

#### Tiered Storage Engine

Files are stored on either SSD or HDD, but presented as a single unified filesystem to the user.

**SSD → HDD migration triggers (checked by a periodic cron/daemon):**

| Condition | Action |
|---|---|
| File size > configurable threshold (e.g., 500MB) | Move to HDD after upload completes |
| Last accessed > configurable time (e.g., 30 days) | Move to HDD |
| SSD usage > high watermark (e.g., 80%) | Move least-recently-accessed files to HDD until below target |

**HDD → SSD promotion:**

| Condition | Action |
|---|---|
| File on HDD is accessed (downloaded/streamed/previewed) | Copy to SSD, serve from SSD, update metadata |
| SSD usage > high watermark after promotion | Evict other cold files to make room |

**Implementation:**
- File metadata in Postgres tracks `storage_tier` (hot/cold) and `physical_path`
- Tiering daemon runs as a cron job (e.g., every 15 minutes) — scans metadata, applies rules, moves files, updates records
- On-access promotion is handled inline by the storage API (if file is cold, copy to SSD first, then serve)
- All file moves are atomic: copy to destination → verify checksum → update metadata → delete source

---

### 4.2 MongoDB — `mongodb.denizlg24.com` (Port 27018)

- Standard MongoDB 7.x container (ARM64 build)
- Data directory mounted on SSD (`/mnt/ssd/mongo`)
- Auth enabled, non-default port (27018)
- TLS configured with Let's Encrypt or self-signed certificates
- wiredTiger cache limited to **256MB** to constrain memory usage
- Connected to by external apps using standard connection strings:
  ```
  mongodb://user:pass@mongodb.denizlg24.com:27018/dbname?tls=true
  ```

---

### 4.3 PostgreSQL — `postgres.denizlg24.com` (Port 5433)

- PostgreSQL 16 container (ARM64 build)
- Data directory mounted on SSD (`/mnt/ssd/postgres`)
- Auth enabled, non-default port (5433)
- TLS configured
- Tuned for low memory:
  - `shared_buffers`: 64MB
  - `work_mem`: 4MB
  - `maintenance_work_mem`: 32MB
  - `effective_cache_size`: 256MB
- Used by both external projects and internally by the storage service for file metadata
- Connection string:
  ```
  postgresql://user:pass@postgres.denizlg24.com:5433/dbname?sslmode=require
  ```

---

### 4.4 Admin Panel — `cloud.denizlg24.com` (Port 3002)

Superuser-only interface. Accessible only after admin authentication (TOTP + recovery codes).

#### Features

- **Dashboard:**
  - System health overview (CPU, RAM, disk usage, temperatures) — pulled from the existing Go health monitor
  - SSD/HDD usage breakdown (total, used, available, per-tier)
  - Active connections / recent activity

- **Storage Management:**
  - File browser with tier indicators (hot/cold)
  - Manual tier override (force move file to SSD/HDD)
  - Tiering configuration (thresholds, watermarks, schedules)
  - Storage analytics (upload trends, most accessed files, tier distribution)

- **Database Management:**
  - Embedded Adminer (iframe or reverse proxy) for PostgreSQL
  - Embedded lightweight Mongo viewer (iframe or reverse proxy) for MongoDB
  - Both accessible only through the admin panel (not exposed on their own subdomains)

- **User Management:**
  - Create/delete users
  - Reset user MFA
  - View user activity

- **Backup Management:**
  - View backup history and status
  - Trigger manual backup
  - Configure backup schedule

---

### 4.5 Cloudflared (Tunnel Daemon)

- Runs as a host service (not in Docker)
- Routes managed via Cloudflare Zero Trust dashboard:
  - `storage.denizlg24.com` → `http://storage-service:3001`
  - `cloud.denizlg24.com` → `http://admin-panel:3002`
  - `search.denizlg24.com` → `http://meilisearch:7700`
- Installed on the Pi host, managed via Cloudflare Zero Trust dashboard

---

### 4.6 DDNS Updater (Cron Job)

- Shell script (or small Go/Bun script) running on the host
- Runs every 5 minutes via cron
- Checks current public IPv4 using a service like `ifconfig.me`
- Compares with current Cloudflare DNS A record
- If changed, updates A records for `mongodb.denizlg24.com` and `postgres.denizlg24.com` via Cloudflare API
- Also updates AAAA records with current IPv6 for dual-stack access
- Logs changes for audit

---

### 4.7 Meilisearch (Search Sidecar)

MongoDB Atlas Search (`$search` aggregation stage) is not available on self-hosted MongoDB — it's an Atlas-exclusive feature powered by Lucene. To support apps that were built against Atlas Search, we run **Meilisearch** as a lightweight search sidecar.

- Meilisearch container (~80–120MB RAM), ARM64 compatible
- Data directory mounted on SSD (`/mnt/ssd/meilisearch`)
- Exposed via Cloudflare Tunnel at `search.denizlg24.com` — external apps access it directly using Meilisearch API keys
- Auth handled by Meilisearch's built-in API key system (master key for admin, scoped search keys for clients)
- Apps sync their MongoDB collections to Meilisearch indexes and query Meilisearch directly for search, then use the returned document IDs to fetch full documents from MongoDB
- Syncing is done via **MongoDB change streams** — a shared utility watches collections and keeps Meilisearch indexes up to date in near-real-time

#### Why Meilisearch over alternatives

| Option | RAM | Notes |
|---|---|---|
| **Meilisearch** | ~80–120MB | Lightweight, fast, typo-tolerant, great relevance, ARM64 Docker image |
| Typesense | ~100–150MB | Similar to Meilisearch, slightly heavier |
| OpenSearch/Elasticsearch | 500MB+ | Way too heavy for a 4GB Pi |

See [`SEARCH_MIGRATION.md`](./SEARCH_MIGRATION.md) for a guide on migrating `$search` queries to Meilisearch.

---

### 4.8 Database Backup (Cron Job)

- Runs daily (configurable)
- `pg_dump` for PostgreSQL → compressed archive → `/mnt/ssd/backups/` → older backups rotated to `/mnt/hdd/backups/`
- `mongodump` for MongoDB → compressed archive → same rotation strategy
- Retention policy: keep last 7 daily snapshots on SSD, last 30 on HDD
- Backup status exposed to admin panel via a simple status file or API

---

## 5. Authentication System

### Users

- **Superuser (admin):** Created during initial setup. Has access to everything.
- **Regular users:** Created by the superuser only. Access to cloud storage only.

### Authentication Flow

#### Regular Users
1. Username + password login
2. TOTP (authenticator app) as second factor
3. Session token (JWT or session cookie) issued on success

#### Superuser
1. Username + password login
2. TOTP (authenticator app) as second factor
3. **Recovery code verification** — a set of one-time codes generated at registration, one must be entered as a third factor for admin login
4. Session token issued on success

### API Keys
- Users (and superuser) can generate API keys from their profile
- API keys authenticate programmatic access to the storage API
- Scoped per-user, revocable

### Implementation
- Auth service built into the storage service and admin panel (shared auth library in the monorepo)
- Passwords hashed with argon2
- TOTP secrets stored encrypted in PostgreSQL
- Recovery codes stored hashed in PostgreSQL
- Sessions stored in PostgreSQL (or in-memory with short TTL)

---

## 6. Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun (TypeScript) |
| Storage API + Web UI | Hono (lightweight HTTP framework) serving a React SPA |
| Admin Panel | Hono serving a React SPA |
| Frontend framework | React with Vite (static SPA build, no SSR — saves RAM) |
| Database (metadata + auth) | PostgreSQL 16 |
| Database (external projects) | PostgreSQL 16 + MongoDB 7 |
| ORM | Drizzle (lightweight, TypeScript-native) |
| File previews | Sharp (images), pdf.js (PDFs), native video element (streaming) |
| Auth | Custom (argon2, otpauth for TOTP) |
| Search (Atlas Search replacement) | Meilisearch (sidecar, synced via change streams) |
| Containerization | Docker + Docker Compose |
| Tunnel | Cloudflared |
| DB admin tools | Adminer (Postgres), mongo-express with `--minimal` or Mongoku (Mongo) |
| DDNS | Shell script + Cloudflare API |
| Backups | pg_dump / mongodump + cron |

### Why React SPA over Next.js SSR

- SSR requires a running Node/Bun process per app that renders pages on each request — more CPU and memory
- A static React SPA is built once, served as static files by the same Hono API server — zero rendering overhead
- On 4GB RAM this matters: SSR for two apps could add 200-400MB of overhead
- Trade-off: no server-side rendering benefits (SEO, initial load) — acceptable for private apps behind auth

### Why Hono over Express

- Hono is ~14KB, Express is ~200KB+ with middleware
- Hono runs natively on Bun with better performance
- Hono has built-in middleware for CORS, auth, etc.

### Why Drizzle over Prisma

- Drizzle has a smaller runtime footprint (no query engine binary)
- Better for resource-constrained environments
- TypeScript-native, no code generation step

---

## 7. Monorepo Structure

```
deniz-cloud/
├── PLAN.md
├── docker-compose.yml
├── .env.example
├── packages/
│   ├── shared/                  # Shared types, auth logic, utilities
│   │   ├── src/
│   │   │   ├── auth/            # Auth helpers (argon2, TOTP, JWT)
│   │   │   ├── db/              # Drizzle schema, connection helpers
│   │   │   ├── search/          # Meilisearch client, change stream sync utility
│   │   │   ├── storage/         # Tiering logic, file helpers
│   │   │   └── types/           # Shared TypeScript types
│   │   └── package.json
│   │
│   ├── storage-api/             # Storage service backend (Hono on Bun)
│   │   ├── src/
│   │   │   ├── routes/          # API routes (files, folders, share, auth)
│   │   │   ├── services/        # Business logic (upload, tiering, preview)
│   │   │   ├── middleware/      # Auth middleware, rate limiting
│   │   │   └── index.ts         # Entry point
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── storage-ui/              # Storage web UI (React + Vite)
│   │   ├── src/
│   │   │   ├── components/      # File browser, upload, preview components
│   │   │   ├── pages/           # Login, dashboard, folder view
│   │   │   └── hooks/           # API hooks
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── admin-api/               # Admin panel backend (Hono on Bun)
│   │   ├── src/
│   │   │   ├── routes/          # Dashboard, user mgmt, backup, tiering config
│   │   │   ├── services/        # System stats, backup triggers
│   │   │   └── index.ts
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── admin-ui/                # Admin panel web UI (React + Vite)
│       ├── src/
│       │   ├── components/      # Dashboard widgets, user table, DB viewers
│       │   └── pages/           # Dashboard, users, storage, databases
│       ├── package.json
│       └── vite.config.ts
│
├── scripts/
│   ├── infra/
│   │   ├── ddns-update.sh/      # DDNS updater script
│   ├── backup.sh                # Database backup script
│   └── tiering.sh               # Tiering daemon (or built into storage-api)
│
├── config/
│   ├── cloudflared/             # Tunnel config
│   ├── meilisearch/             # Meilisearch config (optional)
│   ├── mongo/                   # MongoDB config (mongod.conf)
│   ├── postgres/                # PostgreSQL config (postgresql.conf)
│   └── nginx/                   # Optional: reverse proxy config
│
└── certs/                       # TLS certificates (gitignored)
```

**Note:** The storage-api serves the built storage-ui as static files (same for admin-api + admin-ui). This means only 2 server processes, not 4.

---

## 8. Docker Compose Services

| Service | Image/Build | Port | Memory Limit |
|---|---|---|---|
| `postgres` | postgres:16-alpine | 5433 | 200MB |
| `mongodb` | mongo:7 | 27018 | 400MB |
| `storage` | Custom (Bun + Hono) | 3001 | 300MB |
| `admin` | Custom (Bun + Hono) | 3002 | 250MB |
| `adminer` | adminer:latest | 8080 (internal only) | 100MB |
| `mongo-ui` | mongoku or similar | 8081 (internal only) | 80MB |
| `meilisearch` | getmeili/meilisearch:latest | 7700 (via CF Tunnel) | 120MB |

**Total Docker memory limits: ~1.45GB**
Remaining ~2.55GB for OS, disk cache, host services (incl. cloudflared), and headroom.

Adminer and mongo-ui are only accessible through the admin panel (internal Docker network, not exposed to host ports or Cloudflare).

---

## 9. Networking

### Cloudflare Tunnels (HTTP services)

| Subdomain | Target | Protocol |
|---|---|---|
| `storage.denizlg24.com` | `http://localhost:3001` | HTTP (proxied by CF) |
| `cloud.denizlg24.com` | `http://localhost:3002` | HTTP (proxied by CF) |
| `search.denizlg24.com` | `http://localhost:7700` | HTTP (proxied by CF) |

### Port Forwarding + DDNS (Database services)

| Subdomain | Port | Protocol | DNS Record |
|---|---|---|---|
| `mongodb.denizlg24.com` | 27018 | TCP (MongoDB wire protocol) | A + AAAA (DNS-only, no CF proxy) |
| `postgres.denizlg24.com` | 5433 | TCP (PostgreSQL wire protocol) | A + AAAA (DNS-only, no CF proxy) |

### Router Port Forwarding Rules

| External Port | Internal Port | Protocol | Target |
|---|---|---|---|
| 27018 | 27018 | TCP | Pi's local IP |
| 5433 | 5433 | TCP | Pi's local IP |

### Security Layers for Exposed DB Ports

- Non-default ports (27018, 5433) to reduce automated scanning
- TLS required on both databases
- Strong auth credentials
- fail2ban on the Pi monitoring auth failures
- UFW firewall: only allow 22 (SSH), 27018, 5433; all other ports blocked (HTTP services go through Cloudflare Tunnel, not host ports)

---

## 10. Implementation Phases

### Phase 1: Foundation

- [x] Set up DDNS updater script + cron
- [x] Configure router port forwarding
- [x] Pi setup (Docker, UFW firewall rules)
- [x] Cloudflared installed on host (routes managed via CF dashboard)
- [x] Initialize monorepo with Bun workspaces (all 5 packages scaffolded)
- [x] Set up Docker Compose with Postgres, MongoDB, Meilisearch, Adminer, mongo-express
- [x] Configure Postgres and MongoDB (auth, memory limits via command args)
- [ ] Configure Meilisearch container (CF Tunnel via search.denizlg24.com, SSD data dir)
- [ ] Set up shared package (types, DB schema with Drizzle, Meilisearch sync utility)
- [ ] Implement auth system (registration, login, TOTP, recovery codes, API keys)

### Phase 2: Storage Service

- [ ] Build storage API (Hono): upload, download, delete, rename, move, folder CRUD
- [ ] Implement file metadata in Postgres via Drizzle
- [ ] Build tiering engine: SSD/HDD migration logic, on-access promotion
- [ ] Set up tiering cron job
- [ ] Build storage web UI: file browser, upload, folder navigation
- [ ] Add file previews (images, PDFs, video streaming, code)
- [ ] Implement shareable public links

### Phase 3: Admin Panel

- [ ] Build admin API: system stats, user CRUD, backup management, tiering config
- [ ] Build admin web UI: dashboard, storage overview, user management
- [ ] Integrate Adminer and Mongo UI (embedded, internal-only)
- [ ] Expose health monitor data in dashboard

### Phase 4: Backup & Hardening

- [ ] Set up database backup cron (pg_dump, mongodump, rotation)
- [ ] Configure fail2ban for SSH + DB ports
- [x] UFW firewall rules (done in Phase 1 — SSH, Postgres, MongoDB)
- [ ] TLS certificates for databases
- [ ] Load testing on Pi to verify memory budget
- [ ] Set up Docker restart policies (always restart)

### Phase 5: Polish & Optional

- [ ] S3-compatible API subset
- [ ] File search (by name, across folders)
- [ ] Bulk download as ZIP
- [ ] Upload progress indicators
- [ ] Mobile-responsive UI
- [ ] Email/notification on backup failure

---

## 11. Open Decisions (To Be Determined During Implementation)

| Decision | Options | Notes |
|---|---|---|
| Tiering thresholds | File size cutoff, idle time before cold migration, SSD watermark % | Start with 500MB / 30 days / 80%, tune based on usage |
| Session storage | PostgreSQL vs in-memory | In-memory is faster but lost on restart; PG is durable |
| ~~Mongo UI tool~~ | ~~Mongoku vs mongo-express --minimal vs custom~~ | **Decided: mongo-express.** Running in Docker, 80MB limit |
| File storage path scheme | `/{userId}/{folderId}/{fileId}` vs flat with DB mapping | Flat + DB mapping is simpler for tiering |
| Video streaming | Direct file serve vs HLS chunked | Direct is simpler, HLS better for large files |
| SPA routing | Hash router vs history API (needs server catch-all) | Hono catch-all is trivial, history API is cleaner |
| ~~Atlas Search replacement~~ | ~~Meilisearch sidecar vs keep Atlas vs build proxy~~ | **Decided: Meilisearch sidecar.** Apps query Meilisearch for search, MongoDB for data. See `SEARCH_MIGRATION.md` |
