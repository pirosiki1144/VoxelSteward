FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential cmake python3 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN cp -R src/adapters/persistence/migrations dist/src/adapters/persistence/
RUN npm prune --omit=dev \
    && rm -rf \
      node_modules/axios \
      node_modules/cmake-js \
      node_modules/fstream \
      node_modules/glob \
      node_modules/rimraf \
      node_modules/tar \
      node_modules/unzipper

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src

RUN mkdir -p /auth/profiles && chown -R node:node /auth

USER node

CMD ["node", "dist/src/runtime.js"]
