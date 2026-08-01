import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

import type {
  NotificationOutboxKey,
  NotificationOutboxRecord,
  NotificationOutboxRepository,
  NotificationDeliveryStatus,
} from "../../ports/notification-outbox-repository.js";
import type {
  NotificationSeverity,
  NotificationType,
} from "../../ports/notification-port.js";

interface OutboxRow extends RowDataPacket {
  readonly run_id: string;
  readonly notification_id: string;
  readonly source_revision: number;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly occurred_at: Date;
  readonly title: string;
  readonly body: string;
  readonly delivery_status: NotificationDeliveryStatus;
  readonly delivery_attempts: number;
  readonly max_delivery_attempts: number | null;
  readonly next_attempt_at: Date | null;
  readonly lease_owner: string | null;
  readonly lease_expires_at: Date | null;
  readonly delivered_at: Date | null;
  readonly last_error_code: string | null;
}
interface ClaimLockRow extends RowDataPacket {
  readonly acquired: number | null;
}

const claimLock = "voxel_steward_notification_outbox_claim";

const columns = `run_id, notification_id, source_revision, type, severity,
  occurred_at, title, body, delivery_status, delivery_attempts,
  max_delivery_attempts, next_attempt_at, lease_owner, lease_expires_at,
  delivered_at, last_error_code`;

const recordFrom = (row: OutboxRow): NotificationOutboxRecord =>
  Object.freeze({
    runId: row.run_id,
    notificationId: row.notification_id,
    message: Object.freeze({
      notificationId: row.notification_id,
      sourceRevision: row.source_revision,
      type: row.type,
      severity: row.severity,
      occurredAt: row.occurred_at.toISOString(),
      title: row.title,
      body: row.body,
    }),
    status: row.delivery_status,
    attempts: row.delivery_attempts,
    ...(row.max_delivery_attempts === null
      ? {}
      : { maxAttempts: row.max_delivery_attempts }),
    ...(row.next_attempt_at === null
      ? {}
      : { nextAttemptAt: row.next_attempt_at.toISOString() }),
    ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
    ...(row.lease_expires_at === null
      ? {}
      : { leaseExpiresAt: row.lease_expires_at.toISOString() }),
    ...(row.delivered_at === null
      ? {}
      : { deliveredAt: row.delivered_at.toISOString() }),
    ...(row.last_error_code === null
      ? {}
      : { lastErrorCode: row.last_error_code }),
  });

export class MySqlNotificationOutboxRepository implements NotificationOutboxRepository {
  readonly #pool: Pool;
  #closed = false;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async claimNext(
    workerId: string,
    now: string,
    leaseDurationMs: number,
    maxAttempts: number,
  ): Promise<NotificationOutboxRecord | undefined> {
    this.#ensureOpen();
    if (leaseDurationMs <= 0 || maxAttempts <= 0) throw new RangeError();
    const connection = await this.#pool.getConnection();
    const claimedAt = new Date(now);
    const leaseExpiresAt = new Date(claimedAt.getTime() + leaseDurationMs);
    try {
      const [lockRows] = await connection.query<ClaimLockRow[]>(
        "SELECT GET_LOCK(?, 10) AS acquired",
        [claimLock],
      );
      if (lockRows[0]?.acquired !== 1)
        throw new Error("notification outbox claim lock unavailable");
      await connection.beginTransaction();
      const [rows] = await connection.query<OutboxRow[]>(
        `SELECT ${columns} FROM notification_outbox
         WHERE delivery_status IN ('pending', 'delivering')
         ORDER BY occurred_at, source_revision, run_id, notification_id
         LIMIT 1 FOR UPDATE`,
      );
      const selected = rows[0];
      if (selected === undefined) {
        await connection.commit();
        return undefined;
      }
      const limit = selected.max_delivery_attempts ?? maxAttempts;
      const available =
        (selected.delivery_status === "pending" &&
          (selected.next_attempt_at === null ||
            selected.next_attempt_at.getTime() <= claimedAt.getTime())) ||
        (selected.delivery_status === "delivering" &&
          selected.lease_expires_at !== null &&
          selected.lease_expires_at.getTime() <= claimedAt.getTime());
      if (!available) {
        await connection.commit();
        return undefined;
      }
      if (selected.delivery_attempts >= limit) {
        await connection.execute(
          `UPDATE notification_outbox
           SET delivery_status = 'failed', max_delivery_attempts = ?,
               lease_owner = NULL, lease_expires_at = NULL
           WHERE run_id = ? AND notification_id = ?`,
          [limit, selected.run_id, selected.notification_id],
        );
        await connection.commit();
        return undefined;
      }
      await connection.execute(
        `UPDATE notification_outbox
         SET delivery_status = 'delivering',
             delivery_attempts = delivery_attempts + 1,
             max_delivery_attempts = COALESCE(max_delivery_attempts, ?),
             next_attempt_at = NULL, lease_owner = ?, lease_expires_at = ?,
             last_error_code = NULL
         WHERE run_id = ? AND notification_id = ?`,
        [
          maxAttempts,
          workerId,
          leaseExpiresAt,
          selected.run_id,
          selected.notification_id,
        ],
      );
      const [claimedRows] = await connection.query<OutboxRow[]>(
        `SELECT ${columns} FROM notification_outbox WHERE run_id = ? AND notification_id = ?`,
        [selected.run_id, selected.notification_id],
      );
      await connection.commit();
      const claimed = claimedRows[0];
      if (claimed === undefined)
        throw new Error("notification outbox claim failed");
      return recordFrom(claimed);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      await connection
        .query("SELECT RELEASE_LOCK(?)", [claimLock])
        .catch(() => undefined);
      connection.release();
    }
  }

  async markDelivered(
    key: NotificationOutboxKey,
    workerId: string,
    deliveredAt: string,
  ): Promise<boolean> {
    this.#ensureOpen();
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE notification_outbox
       SET delivery_status = 'delivered', delivered_at = ?, next_attempt_at = NULL,
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = NULL
       WHERE run_id = ? AND notification_id = ?
         AND delivery_status = 'delivering' AND lease_owner = ?`,
      [new Date(deliveredAt), key.runId, key.notificationId, workerId],
    );
    return result.affectedRows === 1;
  }

  async markFailed(
    key: NotificationOutboxKey,
    workerId: string,
    failedAt: string,
    nextAttemptAt: string | undefined,
    errorCode: string,
  ): Promise<"pending" | "failed" | undefined> {
    this.#ensureOpen();
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE notification_outbox
       SET delivery_status = IF(delivery_attempts >= max_delivery_attempts, 'failed', 'pending'),
           next_attempt_at = IF(delivery_attempts >= max_delivery_attempts, NULL, ?),
           lease_owner = NULL, lease_expires_at = NULL, last_error_code = ?
       WHERE run_id = ? AND notification_id = ?
         AND delivery_status = 'delivering' AND lease_owner = ?`,
      [
        nextAttemptAt === undefined
          ? new Date(failedAt)
          : new Date(nextAttemptAt),
        errorCode,
        key.runId,
        key.notificationId,
        workerId,
      ],
    );
    if (result.affectedRows !== 1) return undefined;
    const [rows] = await this.#pool.query<OutboxRow[]>(
      `SELECT ${columns} FROM notification_outbox WHERE run_id = ? AND notification_id = ?`,
      [key.runId, key.notificationId],
    );
    const status = rows[0]?.delivery_status;
    return status === "pending" || status === "failed" ? status : undefined;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("notification outbox repository closed");
  }
}
