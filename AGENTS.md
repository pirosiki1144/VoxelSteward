# VoxelSteward Agent Guide

## Scope

VoxelSteward is a safety-first automation client for Minecraft Bedrock Dedicated
Server. The current implementation is a read-only normal runtime and smoke-test
connection with in-process and MySQL state persistence, a durable notification
outbox and Discord Incoming Webhook adapter, and a read-only operator task
executor. Local development and bounded delivery through the existing configured
webhook are autonomous within the assigned scope. Real Minecraft connections,
external databases, production infrastructure, and game actions require explicit
approval.

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

- Treat the driving GitHub Issue as the source of truth for active scope,
  acceptance criteria, dependencies, and progress. Use
  `docs/project/status.md` for implemented capabilities and constraints,
  `docs/project/roadmap.md` for durable sequencing, and committed verification
  records for completed evidence. Do not reconstruct completed work from chat
  history when these sources already record it.
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

Read `docs/project/status.md` for implemented capabilities and constraints, and
`docs/project/roadmap.md` for durable sequencing. Read the driving GitHub Issue
for the current task, acceptance criteria, dependencies, and progress. Do not
copy a potentially stale phase description into agent-specific configuration.

## GitHub issue and pull request workflow

- Use `main` as the release-ready branch and `develop` as the normal development
  integration branch. Do not develop or push directly on either branch.
- Start normal work from `develop` in `feature/<short-purpose>` and target
  `develop`. Start release preparation from `develop` in `release/<version>` and
  reflect the reviewed result into both `main` and `develop`. Start an urgent
  released-code correction from `main` in `hotfix/<short-purpose>` and reflect
  the reviewed fix into both `main` and `develop`.
- Use GitHub Issues as the source of truth for development tasks. Create a branch
  only when implementation begins. An Issue number or title is not required in
  the branch name; link Issues in the Pull Request with `Closes`, `Fixes`, or
  `Refs`.
- Closely related Issues may share one feature branch and Pull Request when they
  have one coherent change purpose. Do not combine unrelated Issues.
- Pull Requests must list changed behavior, verification results, and safety or
  operational impact.
- Treat Pull Request review comments as the authoritative correction requests.
  Apply requested changes on the same branch, rerun affected checks, and update
  the Pull Request instead of opening an unrelated replacement.
- Agents may create and update task-scoped Issues, work branches, and Pull
  Requests under the conditions in `docs/project/governance.md`. They must not
  merge their own Pull Requests.
- Merge only after the required checks pass and the project owner explicitly
  approves the merge on the Pull Request. Never enable auto-merge on an agent's
  own authority.
- After all required merges are complete, agents may delete only their merged,
  task-owned `feature`, `release`, or `hotfix` branches. Do not force-push,
  rewrite reviewed history, or delete `main`, `develop`, unmerged, spike, or
  unknown-owner branches.
- Never place secrets, player names, bot account information, server endpoints,
  authentication material, or live-service output in Issues, Pull Requests,
  review comments, branch names, or commit messages.

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
  task-owned changes. Task-scoped `feature`, `release`, and `hotfix` branch
  pushes and Pull Request creation or updates are autonomous under governance;
  merging, direct pushes to `main` or `develop`, and repository setting changes
  require explicit approval.
- For autonomous operations above, do not ask the user for conversational
  permission merely because Docker socket access, localhost networking, Git
  index writes, or another sandbox capability requires escalation. Submit the
  narrowly scoped escalation directly to the configured automatic reviewer and
  continue when approved. This includes isolated test-service start/health/stop,
  local integration tests, image builds, explicit staging, and verified local
  commits.
- Real Minecraft connections, game actions, external or shared databases,
  production infrastructure changes, authentication-volume changes, Pull Request
  merges, direct `main` or `develop` pushes, repository setting changes, and
  destructive operations require approval or remain forbidden.
- Secrets, player names, bot account information, and server endpoints must not
  be logged, documented, tested, committed, or sent to Discord.

Project configuration cannot override a stricter Codex system policy, sandbox, or
execution-environment restriction. Never attempt to bypass an upstream control.
If the upstream system itself requires a human decision, expose that system
approval; otherwise autonomous operations must not be paused for redundant user
confirmation.

## Agent model routing

- Use `gpt-5.6-terra` with `medium` reasoning for ordinary implementation,
  documentation, GitHub coordination, and default subagent work.
- Use `gpt-5.6-sol` with `high` reasoning for complex design, broad changes,
  concurrency, safety stops, secret handling, data integrity, or other high-risk
  work.
- Use `gpt-5.6-luna` with `low` reasoning only for clearly bounded, repetitive,
  and low-judgment transformations or narrow test additions.
- Do not route unclear work to Luna. Do not route concurrency, safety, secrets,
  data corruption, or external-service writes to Luna.
- Escalate Luna work to Terra when requirements need interpretation, existing
  patterns do not apply, multiple modules are affected, tests fail, or scope is
  no longer narrow. Escalate Terra work to Sol for architectural changes,
  cross-cutting changes, concurrency or data-integrity risk, secret or external
  service risk, Minecraft safety-stop impact, or a consequential design choice.
- Do not use model escalation as unlimited retry. Report the reason and preserve
  completed work when handing work upward.
- Avoid duplicate implementation and unnecessary subagent launches. Parallel
  agents are limited to independent read-only investigation or verification.
