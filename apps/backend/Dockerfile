# syntax=docker/dockerfile:1

FROM oven/bun:1-alpine AS bun

FROM rust:alpine AS rust-builder
WORKDIR /usr/src/dataset-handling

RUN apk add --no-cache ca-certificates git make g++ musl-dev

COPY dataset-handling/ .
RUN cargo build --release

FROM node:26-alpine AS base
ENV BUN_INSTALL=/usr/local
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /workspace

FROM base AS deps
COPY package.json bun.lock nx.json tsconfig.base.json ./
COPY eslint.config.mjs jest.config.ts jest.preset.js ./
COPY apps/backend/project.json apps/backend/tsconfig*.json apps/backend/webpack.config.js ./apps/backend/
COPY shared-types/project.json shared-types/tsconfig*.json ./shared-types/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

FROM deps AS prisma-deps
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY apps/backend ./apps/backend
RUN bun x prisma generate --schema prisma/schema.prisma

FROM prisma-deps AS builder
COPY shared-types ./shared-types
RUN bun x nx build backend

FROM base AS production-deps
ENV NODE_ENV=production
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production \
    PORT=8080 \
    RUST_BINARY_PATH=/usr/local/bin/dataset-handling \
    PYTHON_BINARY_PATH=/opt/venv/bin/python
WORKDIR /app

COPY --from=builder /workspace/dist/apps/backend/assets/python/requirements.txt /tmp/python-requirements.txt

RUN apk add --no-cache ca-certificates dumb-init postgresql-client python3 py3-pip tzdata \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r /tmp/python-requirements.txt \
    && rm /tmp/python-requirements.txt \
    && addgroup -S app \
    && adduser -S app -G app \
    && mkdir -p /app/temp /app/uploads

COPY --from=production-deps --chown=app:app /workspace/node_modules ./node_modules
COPY --from=prisma-deps --chown=app:app /workspace/prisma.config.ts ./prisma.config.ts
COPY --from=prisma-deps --chown=app:app /workspace/prisma ./prisma
COPY --from=builder --chown=app:app /workspace/dist/apps/backend ./
COPY --from=rust-builder /usr/src/dataset-handling/target/release/dataset-handling /usr/local/bin/dataset-handling

RUN chmod +x /usr/local/bin/dataset-handling \
    && chown -R app:app /app

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "main.js"]
