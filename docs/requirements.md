# Requirements

## 1. Purpose and current scope

VoxelSteward will eventually connect to a Minecraft Bedrock Dedicated Server
and perform controlled work. This initial milestone provides only the
TypeScript development foundation, operational documentation, a health
endpoint, and a database service definition.

Out of scope for this milestone:

- Minecraft server or account connections
- `bedrock-protocol` installation or use
- autonomous decisions or in-game actions
- production deployment and production credentials
- application database queries

## 2. Platform

- Node.js 24 LTS
- TypeScript and npm
- Docker Engine and Docker Compose on Ubuntu under WSL2 for local services
- A design portable to a Linux VPS or AWS container runtime
- PostgreSQL as the initial Compose-managed database candidate

## 3. Safety requirements

The following requirements are invariants, not optional features:

1. New behavior must be verified on an isolated test server before production.
2. Detection of any other player must immediately stop the current task and
   initiate logout.
3. Safety controls must not have bypasses or disable switches.
4. The bot must avoid combat by default and retreat or disconnect rather than
   engage.
5. SIGTERM must initiate an orderly shutdown: stop accepting work, persist a
   checkpoint, disconnect, release the instance lock, and exit.
6. A lease or lock must prevent two processes from controlling one bot
   identity.
7. Long-running work must be resumable from durable checkpoints.
8. Authentication caches must live in a mounted runtime-data location separate
   from source and must never be committed.

Production activation requires an explicit deployment configuration distinct
from test configuration and evidence that the relevant behavior passed on the
test server.

## 4. Engineering requirements

- Logs are newline-delimited JSON with timestamp, level, event, and contextual
  fields. Secrets and account data must be redacted.
- The process exposes a health endpoint. Liveness and readiness may be split
  once external dependencies exist.
- Database access is hidden behind Repository interfaces.
- Database schema changes are versioned migrations.
- Configuration is supplied through environment variables and validated at
  startup.
- Credentials, `.env` files, authentication caches, logs, and runtime data are
  excluded from Git.
- Core behavior is unit-testable without Minecraft or a database.

## 5. Initial acceptance criteria

- The documented project structure exists.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass.
- Starting the built program serves `GET /health` and emits structured logs.
- SIGTERM closes the health server cleanly.
- Docker Compose can define a persistent PostgreSQL service with a health
  check, without embedding production secrets.
