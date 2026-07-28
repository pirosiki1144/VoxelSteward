# Operations

## Local prerequisites

- Ubuntu on WSL2
- Node.js 24 LTS and npm
- Docker Engine with the Compose plugin

## Development

```bash
cp .env.example .env
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm start
```

The default health endpoint is `http://127.0.0.1:3000/health`.

Start only the development database:

```bash
docker compose up -d db
docker compose ps
```

Stop it without deleting its persistent volume:

```bash
docker compose down
```

## Configuration and secrets

`.env.example` documents names and non-secret local defaults. `.env` is local
and ignored. Never place production passwords, Minecraft account details,
tokens, or authentication caches in source control. Store the authentication
cache outside this repository and mount it read-write only into the future
application container.

Use a secret manager or deployment-injected secret files in AWS/VPS
environments. Rotate any credential that is accidentally logged or committed.

## Safe rollout

1. Build and run all automated checks.
2. Apply migrations to the test database.
3. Deploy with the dedicated test-server configuration.
4. Verify player detection, safety stop, checkpoint recovery, lease loss,
   combat avoidance, and SIGTERM behavior.
5. Review structured logs for secret leakage and shutdown completion.
6. Only then promote the same tested artifact to production using separate
   credentials and configuration.

Safety controls must not be disabled to complete a rollout. A failed safety
test blocks promotion.

## Shutdown

Send SIGTERM and allow the configured grace period. The future connected
process must stop new work, checkpoint, disconnect, and release its lease
before exiting. SIGKILL is a last resort because it prevents this sequence.

## Backup and migration

Back up the database before destructive migrations. Migrations must be
forward-versioned and reproducible in a fresh database. Periodically test
checkpoint and database restoration. Persistent Docker volumes are convenient
local storage, not a backup.

## Incident response

If unexpected behavior or another player is observed, stop the process, retain
logs and checkpoints, and do not restart against production. Reproduce and
validate the correction on the test server first. If credentials might be
exposed, revoke and rotate them before further testing.
