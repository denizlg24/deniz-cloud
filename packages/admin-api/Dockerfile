# ── Build stage: install all deps and build the UI ──
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/terminal-server/package.json ./packages/terminal-server/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/admin-ui/ ./packages/admin-ui/

RUN cd packages/admin-ui && bun run build

# ── Production stage ──
FROM oven/bun:1-alpine
WORKDIR /app

# Copy built UI first to sequence this stage after the build stage completes
COPY --from=build /app/packages/admin-ui/dist ./packages/admin-api/static

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/terminal-server/package.json ./packages/terminal-server/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY packages/admin-api/ ./packages/admin-api/

WORKDIR /app/packages/admin-api
ENV NODE_ENV=production
EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
