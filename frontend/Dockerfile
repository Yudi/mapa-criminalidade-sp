# Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json bun.lockb .

# https://github.com/oven-sh/bun/issues/5545
RUN apk --no-cache add ca-certificates wget

RUN if [[ $(uname -m) == "aarch64" ]] ; \
    then \
    # aarch64
    wget https://raw.githubusercontent.com/squishyu/alpine-pkg-glibc-aarch64-bin/master/glibc-2.26-r1.apk ; \
    apk add --no-cache --allow-untrusted --force-overwrite glibc-2.26-r1.apk ; \
    rm glibc-2.26-r1.apk ; \
    else \
    # x86_64
    wget https://github.com/sgerrand/alpine-pkg-glibc/releases/download/2.28-r0/glibc-2.28-r0.apk ; \
    wget -q -O /etc/apk/keys/sgerrand.rsa.pub https://alpine-pkgs.sgerrand.com/sgerrand.rsa.pub ; \
    apk add --no-cache --force-overwrite glibc-2.28-r0.apk ; \
    rm glibc-2.28-r0.apk ; \
    fi
###########

RUN yarn global add bun
RUN bun install --frozen-lockfile

COPY . .

RUN bun run build --configuration=production

FROM node:20-alpine
WORKDIR /usr/app
COPY --from=build /app/src/dist/frontend ./
CMD node server/server.mjs
EXPOSE 4000