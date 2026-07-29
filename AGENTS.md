# VoxelSteward Agent Guide

## Scope

VoxelSteward is intended to become a safety-first automation client for Minecraft
Bedrock Dedicated Server. The current phase permits only a read-only smoke-test
connection in addition to the TypeScript development foundation and
documentation. Do not add game actions or autonomous behavior unless the project
owner explicitly changes the phase without weakening the safety invariants below.

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
- Keep authentication caches, credentials, and account data outside source and
  outside Git.

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

## Documentation

Architecture or safety changes must update the relevant file under `docs/`.
Record durable technical choices in `docs/decisions.md`.
