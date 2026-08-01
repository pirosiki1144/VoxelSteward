import type {
  Pool,
  PoolConnection,
  ResultSetHeader,
  RowDataPacket,
} from "mysql2/promise";

import { blockOperationInstructionEquals } from "../../domain/block-operation/index.js";
import {
  claimTask,
  type TaskQueueItem,
  type TaskExecutionPhase,
  type TaskQueueStatus,
} from "../../domain/task-queue/index.js";
import type { TaskQueueRepository } from "../../ports/task-queue-repository.js";
import {
  decodeTaskInstructionDetails,
  encodeTaskInstructionDetails,
  TaskInstructionCodecError,
} from "./task-instruction-codec.js";

interface TaskQueueRow extends RowDataPacket {
  readonly task_id: string;
  readonly task_type: string;
  readonly priority: number;
  readonly status: TaskQueueStatus;
  readonly attempts: number;
  readonly max_attempts: number;
  readonly instruction_version: number | null;
  readonly instruction_json: unknown;
  readonly execution_phase: TaskExecutionPhase;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly claimed_at: Date | null;
  readonly finished_at: Date | null;
}

const selectColumns = `task_id, task_type, priority, status, attempts,
  max_attempts, instruction_version, instruction_json, execution_phase,
  created_at, updated_at, claimed_at, finished_at`;

const freezeRow = (row: TaskQueueRow): TaskQueueItem => {
  const details = decodeTaskInstructionDetails(
    row.instruction_version,
    row.instruction_json,
  );
  if (
    details !== undefined &&
    (details.instruction.taskId !== row.task_id ||
      details.instruction.taskType !== row.task_type ||
      row.max_attempts !== 1)
  ) {
    throw new TaskInstructionCodecError();
  }
  return Object.freeze({
    taskId: row.task_id,
    taskType: row.task_type,
    priority: row.priority,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    ...(details === undefined ? {} : { details }),
    executionPhase: row.execution_phase,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.claimed_at === null
      ? {}
      : { claimedAt: row.claimed_at.toISOString() }),
    ...(row.finished_at === null
      ? {}
      : { finishedAt: row.finished_at.toISOString() }),
  });
};

export class MySqlTaskQueueRepository implements TaskQueueRepository {
  readonly #pool: Pool;
  #closed = false;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async insert(item: TaskQueueItem): Promise<TaskQueueItem> {
    this.#ensureOpen();
    const encoded = encodeTaskInstructionDetails(item.details);
    await this.#pool.execute(
      `INSERT INTO task_queue
        (task_id, task_type, priority, status, attempts, max_attempts,
         instruction_version, instruction_json, execution_phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE task_id = VALUES(task_id)`,
      [
        item.taskId,
        item.taskType,
        item.priority,
        item.status,
        item.attempts,
        item.maxAttempts,
        encoded.version,
        encoded.json,
        item.executionPhase,
        new Date(item.createdAt),
        new Date(item.updatedAt),
      ],
    );
    const persisted = await this.find(item.taskId);
    if (persisted === undefined) throw new Error("task queue insert failed");
    if (
      (persisted.details !== undefined || item.details !== undefined) &&
      (persisted.taskType !== item.taskType ||
        persisted.priority !== item.priority ||
        persisted.maxAttempts !== item.maxAttempts ||
        persisted.details?.version !== item.details?.version ||
        persisted.details?.kind !== item.details?.kind ||
        persisted.details === undefined ||
        item.details === undefined ||
        !blockOperationInstructionEquals(
          persisted.details.instruction,
          item.details.instruction,
        ))
    ) {
      throw new TaskInstructionCodecError();
    }
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
      const current = freezeRow(rows[0]);
      const claimed = claimTask(current, () => new Date(claimedAt));
      await this.#replace(connection, current, claimed);
      await connection.commit();
      return claimed;
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  async replace(expected: TaskQueueItem, item: TaskQueueItem): Promise<void> {
    this.#ensureOpen();
    const [result] = await this.#pool.execute<ResultSetHeader>(
      `UPDATE task_queue SET status = ?, attempts = ?, execution_phase = ?, updated_at = ?, claimed_at = ?, finished_at = ?
       WHERE task_id = ? AND status = ? AND execution_phase = ? AND updated_at = ?`,
      [
        item.status,
        item.attempts,
        item.executionPhase,
        new Date(item.updatedAt),
        item.claimedAt === undefined ? null : new Date(item.claimedAt),
        item.finishedAt === undefined ? null : new Date(item.finishedAt),
        item.taskId,
        expected.status,
        expected.executionPhase,
        new Date(expected.updatedAt),
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
    expected: TaskQueueItem,
    item: TaskQueueItem,
  ): Promise<void> {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE task_queue SET status = ?, attempts = ?, execution_phase = ?, updated_at = ?, claimed_at = ?, finished_at = ?
       WHERE task_id = ? AND status = ? AND execution_phase = ? AND updated_at = ?`,
      [
        item.status,
        item.attempts,
        item.executionPhase,
        new Date(item.updatedAt),
        item.claimedAt === undefined ? null : new Date(item.claimedAt),
        item.finishedAt === undefined ? null : new Date(item.finishedAt),
        item.taskId,
        expected.status,
        expected.executionPhase,
        new Date(expected.updatedAt),
      ],
    );
    if (result.affectedRows !== 1) throw new Error("task queue conflict");
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("task queue repository closed");
  }
}
