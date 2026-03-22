# ── Build stage: compile node-pty native addon for Node.js ──
FROM node:22-slim AS build
WORKDIR /app

RUN apt-get update && apt-get install -y make gcc g++ python3 && rm -rf /var/lib/apt/lists/*

# Install only terminal-server dependencies with npm (not bun workspace)
COPY packages/terminal-server/package.json ./
RUN npm install

COPY packages/terminal-server/src ./src

# ── Production stage ──
FROM node:22-slim
WORKDIR /app

# nsenter for host namespace access
RUN apt-get update && apt-get install -y util-linux && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./

ENV NODE_ENV=production
EXPOSE 3003

CMD ["node", "--experimental-strip-types", "src/index.ts"]
