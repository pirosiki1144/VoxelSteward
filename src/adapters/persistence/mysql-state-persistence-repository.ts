import type { Pool, PoolConnection, ResultSetHeader } from "mysql2/promise";

import type {
  StateChangeEvent,
  StateSnapshot,
} from "../../domain/state/index.js";
import type { NotificationMessage } from "../../ports/notification-port.js";
import {
  PersistenceError,
  type StatePersistenceRepository,
} from "../../ports/state-persistence-repository.js";

const transientCodes = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "PROTOCOL_CONNECTION_LOST",
  "ER_LOCK_DEADLOCK",
  "ER_LOCK_WAIT_TIMEOUT",
]);

const classify = (error: unknown): PersistenceError => {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  const retryable = code !== undefined && transientCodes.has(code);
  return new PersistenceError(
    retryable ? "PERSISTENCE_TRANSIENT" : "PERSISTENCE_FATAL",
    retryable,
  );
};

const json = (value: unknown): string => JSON.stringify(value);

export class MySqlStatePersistenceRepository implements StatePersistenceRepository {
  readonly #pool: Pool;
  readonly #activeConnections = new Set<PoolConnection>();
  #closed = false;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async initialize(runId: string, startedAt: string): Promise<void> {
    if (this.#closed) throw new PersistenceError("PERSISTENCE_FATAL", false);
    try {
      await this.#pool.execute(
        "INSERT INTO runtime_runs (run_id, started_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE run_id = VALUES(run_id)",
        [runId, new Date(startedAt)],
      );
    } catch (error) {
      throw classify(error);
    }
  }

  async persist(
    runId: string,
    event: StateChangeEvent,
    notification: NotificationMessage | undefined,
  ): Promise<void> {
    if (this.#closed) throw new PersistenceError("PERSISTENCE_FATAL", false);
    let connection: PoolConnection | undefined;
    try {
      connection = await this.#pool.getConnection();
      this.#activeConnections.add(connection);
      await connection.beginTransaction();
      await connection.execute(
        `INSERT INTO state_history
          (run_id, revision, occurred_at, cause, changed_fields_json, before_json, after_json)
         VALUES (?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE revision = VALUES(revision)`,
        [
          runId,
          event.revision,
          new Date(event.occurredAt),
          event.cause,
          json(event.changedFields),
          json(event.before),
          json(event.after),
        ],
      );
      await connection.execute(
        `INSERT INTO state_snapshots (run_id, revision, updated_at, snapshot_json)
         VALUES (?, ?, ?, CAST(? AS JSON))
         ON DUPLICATE KEY UPDATE
           updated_at = IF(VALUES(revision) > revision, VALUES(updated_at), updated_at),
           snapshot_json = IF(VALUES(revision) > revision, VALUES(snapshot_json), snapshot_json),
           revision = IF(VALUES(revision) > revision, VALUES(revision), revision)`,
        [
          runId,
          event.revision,
          new Date(event.after.updatedAt),
          json(event.after),
        ],
      );
      await this.#persistCheckpoint(connection, runId, event.after);
      if (notification !== undefined) {
        await connection.execute(
          `INSERT INTO notification_outbox
            (run_id, notification_id, source_revision, type, severity, occurred_at, title, body)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE notification_id = VALUES(notification_id)`,
          [
            runId,
            notification.notificationId,
            notification.sourceRevision,
            notification.type,
            notification.severity,
            new Date(notification.occurredAt),
            notification.title,
            notification.body,
          ],
        );
      }
      await connection.commit();
    } catch (error) {
      if (connection !== undefined) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the classified persistence failure.
        }
      }
      throw classify(error);
    } finally {
      if (connection !== undefined) {
        this.#activeConnections.delete(connection);
        connection.release();
      }
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    for (const connection of this.#activeConnections) connection.destroy();
    this.#activeConnections.clear();
    await this.#pool.end();
  }

  async #persistCheckpoint(
    connection: PoolConnection,
    runId: string,
    snapshot: StateSnapshot,
  ): Promise<ResultSetHeader | undefined> {
    if (
      snapshot.task.id === undefined ||
      snapshot.task.type === undefined ||
      snapshot.task.state === "idle"
    )
      return undefined;
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO task_checkpoints
        (run_id, task_id, revision, task_type, task_state, updated_at, checkpoint_json)
       VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))
       ON DUPLICATE KEY UPDATE
         task_type = IF(VALUES(revision) > revision, VALUES(task_type), task_type),
         task_state = IF(VALUES(revision) > revision, VALUES(task_state), task_state),
         updated_at = IF(VALUES(revision) > revision, VALUES(updated_at), updated_at),
         checkpoint_json = IF(VALUES(revision) > revision, VALUES(checkpoint_json), checkpoint_json),
         revision = IF(VALUES(revision) > revision, VALUES(revision), revision)`,
      [
        runId,
        snapshot.task.id,
        snapshot.revision,
        snapshot.task.type,
        snapshot.task.state,
        new Date(snapshot.task.updatedAt),
        json(snapshot.task),
      ],
    );
    return result;
  }
}

export const toSafePersistenceFailure = (
  error: unknown,
): Readonly<{ code: string; retryable: boolean }> =>
  error instanceof PersistenceError
    ? { code: error.code, retryable: error.retryable }
    : { code: "PERSISTENCE_UNKNOWN", retryable: false };
