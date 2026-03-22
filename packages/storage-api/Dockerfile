# ── Build stage: install all deps and build the UI ──
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/terminal-server/package.json ./packages/terminal-server/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY packages/storage-ui/ ./packages/storage-ui/

RUN cd packages/storage-ui && bun run build

# ── Production stage ──
FROM oven/bun:1-alpine
WORKDIR /app

# Copy built UI first to sequence this stage after the build stage completes
COPY --from=build /app/packages/storage-ui/dist ./packages/storage-api/static

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/terminal-server/package.json ./packages/terminal-server/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY packages/storage-api/ ./packages/storage-api/

WORKDIR /app/packages/storage-api
ENV NODE_ENV=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
