# VoxelSteward

VoxelSteward is the foundation for a safety-first Minecraft Bedrock automation
client. This milestone contains the TypeScript toolchain, documentation,
structured startup/shutdown logs, an HTTP health endpoint, and a local
PostgreSQL Compose service. It does **not** connect to Minecraft or perform
autonomous actions.

## Prerequisites

- Node.js 24 LTS
- npm 11 or newer
- Docker Engine and Docker Compose on Ubuntu/WSL2 (for the database)

## Setup

```bash
npm install
cp .env.example .env
npm run typecheck
npm run lint
npm test
npm run build
```

Run the minimal service:

```bash
npm start
curl http://127.0.0.1:3000/health
```

Run the future development database:

```bash
docker compose up -d db
```

The current application does not connect to this database. It is present to
establish the local infrastructure shape.

## Scripts

- `npm run build` — compile TypeScript into `dist/`
- `npm run typecheck` — check types without emitting files
- `npm run lint` — run ESLint
- `npm test` — run Vitest once
- `npm run format` — format supported files with Prettier
- `npm run format:check` — verify formatting

## Safety

Production use is not ready. Future behavior must first pass on a dedicated
test server. The bot must stop and log out when another player is detected,
avoid combat, preserve checkpoints, prevent concurrent control, and shut down
safely on SIGTERM. These controls must never be bypassed.

Do not commit `.env`, credentials, Minecraft account data, authentication
caches, runtime data, or logs.

See [requirements](docs/requirements.md), [architecture](docs/architecture.md),
[operations](docs/operations.md), and [decisions](docs/decisions.md).
