# syntax=docker/dockerfile:1
# TakaWise API image. Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t takawise-api .
#   docker build -f infra/docker/api.Dockerfile --target migrator -t takawise-migrator .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN npm install -g pnpm@10.34.9
WORKDIR /repo

# ── Build: full workspace install (incl. dev deps) and compile ──
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @takawise/contracts build && pnpm --filter @takawise/api build
# Production-only node_modules for the API (workspace deps included, no scripts).
RUN pnpm --filter @takawise/api deploy --prod --legacy --ignore-scripts /out \
 && cp -r apps/api/dist /out/dist

# ── Migrator: runs `prisma migrate deploy` (needs the Prisma CLI, a dev dependency) ──
FROM build AS migrator
WORKDIR /repo/apps/api
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ── Runtime: minimal, non-root ──
FROM node:24-alpine AS api
ENV NODE_ENV=production PORT=4000
# npm/corepack are not needed at runtime; removing them drops their bundled (often vulnerable) deps.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health >/dev/null || exit 1
CMD ["node", "dist/main.js"]
