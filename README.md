# Deniz Cloud

Self-hosted home server running on a Raspberry Pi 5 (4GB RAM) with tiered storage (NVMe SSD + USB HDD).

## What it does

- **Cloud storage** — Google Drive-like web UI for my family, with file previews, folder organization, and shareable links. Files are transparently tiered between SSD (hot) and HDD (cold) based on access patterns and size.
- **MongoDB & PostgreSQL** — Databases for personal projects, exposed as raw TCP connections over port forwarding with dynamic DNS.
- **Admin panel** — Dashboard for managing users, monitoring storage health, and accessing lightweight DB tools.

## How it's exposed

- `storage.denizlg24.com` — File storage (Cloudflare Tunnel)
- `cloud.denizlg24.com` — Admin panel (Cloudflare Tunnel)
- `search.denizlg24.com` — Mileisearch (Replaces MongoDB Atlas Search)
- `mongodb.denizlg24.com` — MongoDB (port forward + DDNS)
- `postgres.denizlg24.com` — PostgreSQL (port forward + DDNS)

## Stack

Bun, Hono, React, Drizzle, PostgreSQL, MongoDB, Docker Compose, Cloudflared.

See [PLAN.md](./PLAN.md) for the full architecture and implementation plan.
