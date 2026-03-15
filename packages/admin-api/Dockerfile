# ── Build stage: install all deps and build the UI ──
FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/

RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

COPY packages/shared/ ./packages/shared/
COPY packages/admin-ui/ ./packages/admin-ui/

RUN cd packages/admin-ui && bun run build

# ── Production stage ──
FROM oven/bun:1-alpine
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/bun.lock ./bun.lock
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/admin-api/package.json ./packages/admin-api/package.json
COPY --from=build /app/packages/admin-ui/package.json ./packages/admin-ui/package.json
COPY --from=build /app/packages/storage-api/package.json ./packages/storage-api/package.json
COPY --from=build /app/packages/storage-ui/package.json ./packages/storage-ui/package.json

COPY packages/shared/ ./packages/shared/
COPY packages/admin-api/ ./packages/admin-api/
COPY --from=build /app/packages/admin-ui/dist ./packages/admin-api/static

WORKDIR /app/packages/admin-api
ENV NODE_ENV=production
EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
