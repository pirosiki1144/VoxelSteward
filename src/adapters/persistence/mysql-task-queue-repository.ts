import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import {
  claimTask,
  type TaskQueueItem,
  type TaskQueueStatus,
} from "../../domain/task-queue/index.js";
import type { TaskQueueRepository } from "../../ports/task-queue-repository.js";

interface TaskQueueRow extends RowDataPacket {
  readonly task_id: string;
  readonly task_type: string;
  readonly priority: number;
  readonly status: TaskQueueStatus;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly claimed_at: Date | null;
  readonly finished_at: Date | null;
}

const selectColumns = `task_id, task_type, priority, status, attempts,
  max_attempts, created_at, updated_at, claimed_at, finished_at`;

const freezeRow = (row: TaskQueueRow): TaskQueueItem =>
  Object.freeze({
    taskId: row.task_id,
    taskType: row.task_type,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.claimed_at === null
      ? {}
      : { claimedAt: row.claimed_at.toISOString() }),
    ...(row.finished_at === null
      ? {}
      : { finishedAt: row.finished_at.toISOString() }),
  });

export class MySqlTaskQueueRepository implements TaskQueueRepository {
  readonly #pool: Pool;
  #closed = false;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async insert(item: TaskQueueItem): Promise<TaskQueueItem> {
    this.#ensureOpen();
    await this.#pool.execute(
      `INSERT INTO task_queue
        (task_id, task_type, priority, status, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE task_id = VALUES(task_id)`,
      [
        item.taskId,
        item.taskType,
        item.priority,
        item.status,
        item.attempts,
        item.maxAttempts,
        new Date(item.createdAt),
        new Date(item.updatedAt),
      ],
    );
    const persisted = await this.find(item.taskId);
    if (persisted === undefined) throw new Error("task queue insert failed");
    return persisted;
  }

  async find(taskId: string): Promise<TaskQueueItem | undefined> {
    this.#ensureOpen();
    const [rows] = await this.#pool.query<TaskQueueRow[]>(
      `SELECT ${selectColumns} FROM task_queue WHERE task_id = ?`,
      [taskId],
    );
    return rows[0] === undefined ? undefined : freezeRow(rows[0]);
  }

  async claimNext(claimedAt: string): Promise<TaskQueueItem | undefined> {
    this.#ensureOpen();
    const connection = await this.#pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<TaskQueueRow[]>(
        `SELECT ${selectColumns} FROM task_queue
         WHERE status = 'queued'
         ORDER BY priority DESC, created_at ASC, task_id ASC
         LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      if (rows[0] === undefined) {
        await connection.commit();
        return undefined;
      }
      const claimed = claimTask(freezeRow(rows[0]), () => new Date(claimedAt));
      await this.#replace(connection, "queued", claimed);
      await connection.commit();
      return claimed;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async replace(
    expectedStatus: TaskQueueStatus,
    item: TaskQueueItem,
  ): Promise<void> {
    this.#ensureOpen();
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE task_queue SET status = ?, attempts = ?, updated_at = ?, claimed_at = ?, finished_at = ?
       WHERE task_id = ? AND status = ?`,
      [
        item.status,
        item.attempts,
        new Date(item.updatedAt),
        item.claimedAt === undefined ? null : new Date(item.claimedAt),
        item.finishedAt === undefined ? null : new Date(item.finishedAt),
        item.taskId,
        expectedStatus,
      ],
    );
    if (result.affectedRows !== 1) throw new Error("task queue conflict");
  }

  async list(): Promise<readonly TaskQueueItem[]> {
    this.#ensureOpen();
    const [rows] = await this.#pool.query<TaskQueueRow[]>(
      `SELECT ${selectColumns} FROM task_queue ORDER BY priority DESC, created_at, task_id`,
    );
    return Object.freeze(rows.map(freezeRow));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }

  async #replace(
    connection: PoolConnection,
    expectedStatus: TaskQueueStatus,
    item: TaskQueueItem,
  ): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE task_queue SET status = ?, attempts = ?, updated_at = ?, claimed_at = ?, finished_at = ?
       WHERE task_id = ? AND status = ?`,
      [
        item.status,
        item.attempts,
        new Date(item.updatedAt),
        item.claimedAt === undefined ? null : new Date(item.claimedAt),
        item.finishedAt === undefined ? null : new Date(item.finishedAt),
        item.taskId,
        expectedStatus,
      ],
    );
    if (result.affectedRows !== 1) throw new Error("task queue conflict");
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("task queue repository closed");
  }
}
