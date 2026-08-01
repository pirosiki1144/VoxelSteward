# VoxelSteward Agent Guide

## Scope

VoxelSteward is a safety-first automation client for Minecraft Bedrock Dedicated
Server. The current implementation is a read-only normal runtime and smoke-test
connection with in-process state management and a Discord Incoming Webhook
notification adapter. Local development and bounded delivery through the existing
configured webhook are autonomous within the assigned scope. Real Minecraft
connections, external databases, production infrastructure, and game actions
require explicit approval.

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

## Context and token efficiency

These rules apply to every agent and sub-agent working in this repository.

- Treat `docs/project/status.md`, `docs/project/roadmap.md`, and committed
  verification records as the source of truth. Do not reconstruct completed
  work from chat history when the repository already records it.
- Inspect only files relevant to the current task. Use targeted searches and
  bounded command output instead of repeatedly reading the whole repository or
  printing full successful logs.
- Keep progress updates and handoff reports concise. Report outcomes, changed
  files, failed checks, and unresolved risks; do not repeat the complete user
  request or unchanged project history.
- During implementation, run focused tests for the affected area. Run the full
  required verification suite once after the implementation stabilizes, unless
  a failure or high-risk change justifies another full run.
- Reuse existing fixtures, design evidence, and verification records. Do not
  repeat external research or real-service acceptance tests unless the evidence
  is missing, stale, or the relevant behavior changed.
- Delegate only independent, bounded work that benefits from parallelism or
  when the user explicitly requests agents. Give sub-agents the smallest useful
  context and avoid duplicating the same investigation across agents.
- Prefer summaries for successful command output. Preserve detailed diagnostics
  only for failures or evidence that must be recorded.
- Token efficiency never overrides safety checks, required validation,
  documentation accuracy, or approval boundaries.

## Current development phase

Read `docs/project/status.md` for the current baseline, constraints, and next
completion criteria, and `docs/project/roadmap.md` for sequencing. Do not copy a
potentially stale phase description into agent-specific configuration.

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

Follow `docs/project/governance.md` as the authoritative operating boundary.

- Roadmap-scoped source, test, configuration, and documentation edits are
  autonomous.
- Exact-version dependency installation required by the assigned scope is
  autonomous after compatibility, install-script, license, maintenance, and
  security checks.
- Local tests, builds, formatting, Docker image builds, and isolated local
  development or test service startup are autonomous.
- Local test database startup, migrations, rollback checks, and integration tests
  are autonomous when they use disposable non-secret data.
- Bounded delivery through the existing configured Discord Incoming Webhook and
  existing fixed templates is autonomous. Notification failure must never weaken
  Minecraft safety behavior.
- Local commits are autonomous only after all required checks pass and only for
  task-owned changes. Remote Git operations still require approval.
- For autonomous operations above, do not ask the user for conversational
  permission merely because Docker socket access, localhost networking, Git
  index writes, or another sandbox capability requires escalation. Submit the
  narrowly scoped escalation directly to the configured automatic reviewer and
  continue when approved. This includes isolated test-service start/health/stop,
  local integration tests, image builds, explicit staging, and verified local
  commits.
- Real Minecraft connections, game actions, external or shared databases,
  production infrastructure changes, authentication-volume changes, remote Git
  operations, and destructive operations require approval or remain forbidden.
- Secrets, player names, bot account information, and server endpoints must not
  be logged, documented, tested, committed, or sent to Discord.

Project configuration cannot override a stricter Codex system policy, sandbox, or
execution-environment restriction. Never attempt to bypass an upstream control.
If the upstream system itself requires a human decision, expose that system
approval; otherwise autonomous operations must not be paused for redundant user
confirmation.
