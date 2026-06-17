# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS bun

FROM node:26-alpine AS base
ENV BUN_INSTALL=/usr/local 
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workspace

FROM base AS deps
COPY package.json bun.lock nx.json tsconfig.base.json ./
COPY eslint.config.mjs jest.config.ts jest.preset.js ./
COPY apps/frontend/project.json apps/frontend/tsconfig*.json ./apps/frontend/
COPY shared-types/project.json shared-types/tsconfig*.json ./shared-types/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS builder
COPY apps/frontend ./apps/frontend
COPY shared-types ./shared-types
RUN bun x nx build frontend --configuration=production

FROM node:26-alpine AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /workspace/dist/apps/frontend ./

USER app

EXPOSE 4000

CMD ["node", "server/server.mjs"]
