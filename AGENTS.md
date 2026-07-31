# VoxelSteward Agent Guide

## Scope

VoxelSteward is a safety-first automation client for Minecraft Bedrock Dedicated
Server. The current implementation is a read-only normal runtime and smoke-test
connection with in-process state management and an external-service-neutral
notification foundation. Real Discord delivery, database integrations, and game
actions require explicit approval.

The authoritative product requirements, current status, roadmap, and operating
authority are in:

- `docs/requirements.md`
- `docs/project/status.md`
- `docs/project/roadmap.md`
- `docs/project/governance.md`

## Mandatory safety invariants

- Validate every behavior on a dedicated test server before production.
- In `normal` mode, stop work and disconnect immediately when another player
  is detected.
- In the explicitly selected read-only `debug` smoke-test mode, log other
  players joining and leaving while keeping the connection open. Do not add
  game actions to this observation-only exception.
- Never implement a switch, environment variable, or code path that disables
  safety controls.
- Avoid combat by default.
- Handle SIGTERM by stopping work, persisting a checkpoint when applicable,
  disconnecting, and then exiting.
- Prevent concurrent instances from controlling the same bot identity.
- Keep reconnect attempts bounded and never reconnect after a player safety stop
  or an operator-requested stop.
- Keep authentication caches, credentials, and account data outside source and
  outside Git.
- Never store player names, server endpoints, or authentication data in state,
  progress records, tests, or documentation.

## Engineering rules

- Use Node.js 24 LTS, TypeScript, npm, ESLint, Prettier, and Vitest.
- Keep domain logic independent of Minecraft, database, and hosting adapters.
- Access persistence only through Repository interfaces.
- Manage database schema changes with migrations; never rely on manual schema
  edits.
- Emit structured logs and avoid secrets, tokens, or personal data in logs.
- Maintain a health endpoint suitable for Docker, AWS, and Linux VPS probes.
- Add or update tests with behavioral changes.
- Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
  before handing off changes.
- Do not commit generated output, local environment files, authentication
  caches, logs, coverage, or dependencies.
- Keep state-domain code independent of Minecraft, Discord, databases, Docker,
  and process signals.

## Documentation

Architecture or safety changes must update the relevant file under `docs/`.
Record durable technical choices in `docs/decisions.md`.
Record non-secret real-server verification in `docs/verification/`.

### Language policy

- Write frequently human-read project and operations documentation in Japanese.
  This includes `README.md` and the product, architecture, operations, status,
  roadmap, decision, and verification documents under `docs/`.
- Write frequently agent-read instructions and agent configuration in English.
  This includes `AGENTS.md`, `CLAUDE.md`, `.codex/config.toml`, and
  `.codex/agents/*.toml`.
- Keep this policy centralized in `AGENTS.md`; do not duplicate it in each
  individual agent definition.
- When editing an existing file not covered above, preserve its established
  language unless the project owner explicitly requests a migration.

## Approval boundary

Read-only investigation, approved-scope edits, local tests, builds, Compose
configuration validation, and image builds without starting services are allowed.
Follow `docs/project/governance.md` for the full boundary. Stop for approval
before external connections, container/service startup, production dependency
changes, authentication-volume changes, game actions, commits, pushes, merges,
releases, or remote service mutations.
