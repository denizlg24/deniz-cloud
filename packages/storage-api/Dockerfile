# ── Build stage: install all deps and build the UI ──
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/

RUN bun install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/storage-ui/ ./packages/storage-ui/

RUN cd packages/storage-ui && bun run build

# ── Production stage ──
FROM oven/bun:1-alpine
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/

RUN bun install --frozen-lockfile --ignore-scripts

COPY packages/shared/ ./packages/shared/
COPY packages/storage-api/ ./packages/storage-api/
COPY --from=build /app/packages/storage-ui/dist ./packages/storage-api/static

WORKDIR /app/packages/storage-api
ENV NODE_ENV=production
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
