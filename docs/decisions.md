# Architecture Decisions

## ADR-001: Node.js 24, TypeScript, and npm

- Status: Accepted
- Decision: Use Node.js 24 LTS, strict TypeScript, and npm lockfiles.
- Rationale: The candidate Minecraft library is in the Node.js ecosystem, and a
  lockfile gives repeatable CI and deployments.

## ADR-002: Ports and adapters

- Status: Accepted
- Decision: Domain and application code depend on interfaces for Minecraft,
  repositories, checkpoints, and instance locking.
- Rationale: This keeps safety logic testable and permits infrastructure changes
  without rewriting task behavior.

## ADR-003: PostgreSQL as the initial persistence candidate

- Status: Accepted
- Decision: Provide PostgreSQL through Compose. Add the application driver only
  when persistence code is implemented.
- Rationale: PostgreSQL supports transactions, migrations, durable checkpoints,
  and database-backed leases, and is portable across local, VPS, and AWS
  environments.

## ADR-004: bedrock-protocol deferred

- Status: Accepted
- Decision: Treat `bedrock-protocol` as the leading adapter candidate but do not
  install it during the foundation milestone.
- Rationale: No Minecraft connection is in scope yet, and deferring it reduces
  dependency and credential exposure.

## ADR-005: Safety policy is non-configurable

- Status: Accepted
- Decision: Player detection, combat avoidance, test-first rollout, and safety
  shutdown have no bypass configuration.
- Rationale: A runtime bypass would turn an invariant into an operational
  preference and create unacceptable production risk.

## ADR-006: JSON stdout logs and HTTP health

- Status: Accepted
- Decision: Emit newline-delimited JSON to stdout and expose an HTTP health
  endpoint.
- Rationale: Both work locally and integrate cleanly with Docker, systemd, and
  AWS log and health systems.

## ADR-007: Versioned migrations and Repository-only DB access

- Status: Accepted
- Decision: All schema changes use migrations, and application/domain code
  accesses data only through Repository interfaces.
- Rationale: This makes schema state reproducible and isolates persistence
  details.
