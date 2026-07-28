# Architecture

## 1. Design goals

The architecture uses ports and adapters so Minecraft, persistence, and hosting
choices do not leak into task logic. Safety policy sits in the application
boundary and cannot be bypassed by an adapter.

## 2. Target component model

```text
Entrypoint / lifecycle
        |
Application coordinator ---- Safety policy
        |                         |
        +---- Domain tasks -------+
        |
        +---- Minecraft port ---- bedrock-protocol adapter (future)
        +---- Repository ports -- PostgreSQL repositories (future)
        +---- Checkpoint port --- durable checkpoint repository (future)
        +---- Instance lock ----- DB lease/advisory lock (future)
```

Suggested future source layout:

```text
src/
  application/   orchestration, lifecycle, safety policy
  domain/        task state and rules without infrastructure imports
  ports/         Minecraft and Repository interfaces
  adapters/
    minecraft/   bedrock-protocol integration
    persistence/ PostgreSQL repositories and migrations
  infrastructure/ configuration, logging, health, signals
```

The initial source remains deliberately small. Directories are introduced only
when their code exists.

## 3. Lifecycle and safety state

The future coordinator has an explicit state machine:

```text
STARTING -> READY -> WORKING -> STOPPING -> STOPPED
                         \-> SAFETY_STOP -/
```

`SAFETY_STOP` is entered on player detection, unsafe world state, lost lock, or
an unrecoverable adapter error. It cancels work, records a checkpoint when safe,
logs out, and terminates. No transition returns from `SAFETY_STOP` to
`WORKING`.

SIGTERM follows the same stop pipeline with a bounded shutdown timeout.

## 4. Persistence

Application code depends on Repository interfaces rather than SQL clients.
Transactions and SQL remain inside persistence adapters. Schema changes are
ordered migration files applied as a deployment step. Checkpoints include a
task identifier, version, safe resume position, state payload, and timestamp.

A database-backed renewable lease is preferred for distributed deployments.
The lease key is the bot identity; failure to acquire or renew it prevents
work and causes a safe disconnect.

## 5. Authentication data

The future Minecraft adapter receives an authentication-cache path from
configuration. Locally it is a bind mount or named volume outside the
repository. In AWS it should be backed by an encrypted secret or persistent
storage appropriate to the library. Cache contents must not enter logs.

## 6. Observability

The program emits JSON logs to stdout for collection by Docker or a cloud log
driver. `/health` currently reports process liveness. Readiness will later
include configuration, instance lease, database, and Minecraft session state
without exposing secrets.

## 7. Deployment portability

The application is stateless except for repositories and the external
authentication cache. It accepts configuration through environment variables,
logs to stdout, handles SIGTERM, and exposes HTTP health, allowing the same
artifact to run with Compose, systemd, ECS, or another Linux container runtime.
