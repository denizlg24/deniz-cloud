# ── Build stage: compile node-pty native addon ──
FROM oven/bun:1-debian AS build
WORKDIR /app

RUN apt-get update && apt-get install -y make gcc g++ python3 nodejs npm && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY packages/terminal-server/package.json ./packages/terminal-server/
COPY packages/shared/package.json ./packages/shared/
COPY packages/admin-api/package.json ./packages/admin-api/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/storage-api/package.json ./packages/storage-api/
COPY packages/storage-ui/package.json ./packages/storage-ui/

RUN bun install --frozen-lockfile

# node-pty native addon needs explicit rebuild under bun's module layout
RUN NPT_DIR=$(find /app/node_modules -name "binding.gyp" -path "*/node-pty/*" -exec dirname {} \; | head -1) && \
    echo "Rebuilding node-pty in: $NPT_DIR" && \
    cd "$NPT_DIR" && npx --yes node-gyp rebuild

COPY packages/terminal-server/ ./packages/terminal-server/

# ── Production stage ──
FROM oven/bun:1-debian
WORKDIR /app

# nsenter for host namespace access
RUN apt-get update && apt-get install -y util-linux && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/packages/terminal-server/ ./packages/terminal-server/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/admin-api/package.json ./packages/admin-api/
COPY --from=build /app/packages/admin-ui/package.json ./packages/admin-ui/
COPY --from=build /app/packages/storage-api/package.json ./packages/storage-api/
COPY --from=build /app/packages/storage-ui/package.json ./packages/storage-ui/

WORKDIR /app/packages/terminal-server
ENV NODE_ENV=production
EXPOSE 3003

CMD ["bun", "run", "src/index.ts"]
