import type { Pool, RowDataPacket } from "mysql2/promise";

import type {
  OperationalCause,
  OperationalCheckpointSummary,
  OperationalHistoryEntry,
  OperationalLogRepository,
  OperationalRunSummary,
  OperationalStateSummary,
} from "../../ports/operational-log-repository.js";
import { OperationalLogError } from "../../ports/operational-log-repository.js";
import type {
  MinecraftConnectionState,
  RuntimeState,
  TaskState,
} from "../../domain/state/index.js";

interface StateRow extends RowDataPacket {
  readonly run_id?: string;
  readonly started_at?: Date | string;
  readonly revision: number;
  readonly updated_at: Date | string;
  readonly runtime_state: string;
  readonly minecraft_connection: string;
  readonly spawn_completed: number;
  readonly telemetry_status: string;
  readonly position_x: number | null;
  readonly position_y: number | null;
  readonly position_z: number | null;
  readonly dimension: string | null;
  readonly health: number | null;
  readonly hunger: number | null;
  readonly other_player_detected: number;
  readonly task_id: string | null;
  readonly task_type: string | null;
  readonly task_state: string;
  readonly task_updated_at: string;
  readonly stop_reason: string | null;
  readonly last_error_code: string | null;
  readonly occurred_at?: Date | string;
  readonly cause?: string;
}

interface CheckpointRow extends RowDataPacket {
  readonly task_id: string;
  readonly revision: number;
  readonly task_type: string;
  readonly task_state: string;
  readonly updated_at: Date | string;
}

const stateSelection = (
  alias: "s" | "h",
  jsonColumn: "snapshot_json" | "after_json",
  updatedAt: string,
): string => `
  ${alias}.revision,
  ${updatedAt} AS updated_at,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.runtime')) AS runtime_state,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.connection')) AS minecraft_connection,
  JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.spawnCompleted') = TRUE AS spawn_completed,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.telemetryStatus')) AS telemetry_status,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.position.x')) AS DOUBLE) AS position_x,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.position.y')) AS DOUBLE) AS position_y,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.position.z')) AS DOUBLE) AS position_z,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.dimension')) AS dimension,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.health')) AS DOUBLE) AS health,
  CAST(JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.hunger')) AS DOUBLE) AS hunger,
  JSON_EXTRACT(${alias}.${jsonColumn}, '$.minecraft.otherPlayerDetected') = TRUE AS other_player_detected,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.task.id')) AS task_id,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.task.type')) AS task_type,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.task.state')) AS task_state,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.task.updatedAt')) AS task_updated_at,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.stopReason')) AS stop_reason,
  JSON_UNQUOTE(JSON_EXTRACT(${alias}.${jsonColumn}, '$.lastError.code')) AS last_error_code`;

const runtimeStates = new Set([
  "starting",
  "connecting",
  "ready",
  "reconnecting",
  "stopping",
  "stopped",
  "failed",
]);
const connectionStates = new Set([
  "disconnected",
  "connecting",
  "connected",
  "spawned",
]);
const telemetryStates = new Set(["unknown", "valid", "invalid"]);
const taskStates = new Set([
  "idle",
  "preparing",
  "running",
  "paused",
  "completed",
  "failed",
  "stopped",
]);
const dimensions = new Set(["overworld", "nether", "end"]);
const causes = new Set<OperationalCause>([
  "runtime.transition",
  "minecraft.connection.transition",
  "minecraft.spawn.update",
  "minecraft.telemetry.update",
  "minecraft.telemetry.invalidate",
  "safety.other_player_detected",
  "task.prepare",
  "task.transition",
  "task.progress.update",
  "task.reset",
  "runtime.stop_reason.record",
  "runtime.error.record",
]);
const stopReasons = new Set([
  "other_player_detected",
  "signal_sigint",
  "signal_sigterm",
  "stop_requested",
  "reconnect_exhausted",
  "connection_error",
  "internal_error",
]);
const errorCodes = new Set([
  "connection_error",
  "reconnect_exhausted",
  "internal_error",
]);
const safeIdentifier = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const runIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const limitLiteral = (value: number, maximum: number): string => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new OperationalLogError();
  return String(value);
};

const iso = (value: Date | string): string => new Date(value).toISOString();
const finite = (value: number | null): number | undefined =>
  value !== null && Number.isFinite(value) ? value : undefined;
const member = <T extends string>(
  value: string,
  allowed: ReadonlySet<string>,
): T => {
  if (!allowed.has(value)) throw new OperationalLogError();
  return value as T;
};
const optionalMember = (
  value: string | null,
  allowed: ReadonlySet<string>,
): string | undefined =>
  value !== null && allowed.has(value) ? value : undefined;

const summary = (row: StateRow): OperationalStateSummary => {
  const x = finite(row.position_x);
  const y = finite(row.position_y);
  const z = finite(row.position_z);
  const health = finite(row.health);
  const hunger = finite(row.hunger);
  const taskId =
    row.task_id !== null && safeIdentifier.test(row.task_id)
      ? row.task_id
      : undefined;
  const taskType =
    row.task_type !== null && safeIdentifier.test(row.task_type)
      ? row.task_type
      : undefined;
  const taskState = member<TaskState>(row.task_state, taskStates);
  const stopReason = optionalMember(row.stop_reason, stopReasons);
  const lastErrorCode = optionalMember(row.last_error_code, errorCodes);
  const dimension =
    row.dimension === null || !dimensions.has(row.dimension)
      ? undefined
      : member<"overworld" | "nether" | "end">(row.dimension, dimensions);
  return Object.freeze({
    revision: row.revision,
    updatedAt: iso(row.updated_at),
    runtime: member<RuntimeState>(row.runtime_state, runtimeStates),
    minecraftConnection: member<MinecraftConnectionState>(
      row.minecraft_connection,
      connectionStates,
    ),
    spawnCompleted: row.spawn_completed === 1,
    telemetryStatus: member<"unknown" | "valid" | "invalid">(
      row.telemetry_status,
      telemetryStates,
    ),
    ...(x === undefined || y === undefined || z === undefined
      ? {}
      : { position: Object.freeze({ x, y, z }) }),
    ...(dimension === undefined ? {} : { dimension }),
    ...(health === undefined ? {} : { health }),
    ...(hunger === undefined ? {} : { hunger }),
    otherPlayerDetected: row.other_player_detected === 1,
    ...(taskId === undefined || taskType === undefined || taskState === "idle"
      ? {}
      : {
          task: Object.freeze({
            id: taskId,
            type: taskType,
            state: taskState,
            updatedAt: new Date(row.task_updated_at).toISOString(),
          }),
        }),
    ...(stopReason === undefined ? {} : { stopReason }),
    ...(lastErrorCode === undefined ? {} : { lastErrorCode }),
  });
};

export class MySqlOperationalLogRepository implements OperationalLogRepository {
  constructor(private readonly pool: Pool) {}

  async listRuns(limit: number): Promise<readonly OperationalRunSummary[]> {
    return this.query(async () => {
      const safeLimit = limitLiteral(limit, 100);
      const [rows] = await this.pool.execute<StateRow[]>(
        `SELECT r.run_id, r.started_at, ${stateSelection("s", "snapshot_json", "s.updated_at")}
         FROM runtime_runs r
         INNER JOIN state_snapshots s ON s.run_id = r.run_id
         ORDER BY r.started_at DESC, r.run_id DESC LIMIT ${safeLimit}`,
      );
      return rows.map((row) => this.run(row));
    });
  }

  async findRun(runId: string): Promise<OperationalRunSummary | undefined> {
    return this.query(async () => {
      if (!runIdPattern.test(runId)) throw new OperationalLogError();
      const [rows] = await this.pool.execute<StateRow[]>(
        `SELECT r.run_id, r.started_at, ${stateSelection("s", "snapshot_json", "s.updated_at")}
         FROM runtime_runs r
         INNER JOIN state_snapshots s ON s.run_id = r.run_id
         WHERE r.run_id = ?`,
        [runId],
      );
      return rows[0] === undefined ? undefined : this.run(rows[0]);
    });
  }

  async listHistory(
    runId: string,
    afterRevision: number,
    limit: number,
  ): Promise<readonly OperationalHistoryEntry[]> {
    return this.query(async () => {
      if (!runIdPattern.test(runId)) throw new OperationalLogError();
      if (!Number.isSafeInteger(afterRevision) || afterRevision < 0)
        throw new OperationalLogError();
      const safeLimit = limitLiteral(limit, 500);
      const [rows] = await this.pool.execute<StateRow[]>(
        `SELECT h.occurred_at, h.cause, ${stateSelection("h", "after_json", "h.occurred_at")}
         FROM state_history h
         WHERE h.run_id = ? AND h.revision > ?
         ORDER BY h.revision ASC LIMIT ${safeLimit}`,
        [runId, afterRevision],
      );
      return rows.map((row) =>
        Object.freeze({
          ...summary(row),
          occurredAt: iso(row.occurred_at ?? row.updated_at),
          cause: causes.has(row.cause as OperationalCause)
            ? (row.cause as OperationalCause)
            : "unknown",
        }),
      );
    });
  }

  async listCheckpoints(
    runId: string,
    limit: number,
  ): Promise<readonly OperationalCheckpointSummary[]> {
    return this.query(async () => {
      if (!runIdPattern.test(runId)) throw new OperationalLogError();
      const safeLimit = limitLiteral(limit, 500);
      const [rows] = await this.pool.execute<CheckpointRow[]>(
        `SELECT task_id, revision, task_type, task_state, updated_at
         FROM task_checkpoints WHERE run_id = ?
         ORDER BY revision ASC, task_id ASC LIMIT ${safeLimit}`,
        [runId],
      );
      return rows.map((row) => {
        if (
          !safeIdentifier.test(row.task_id) ||
          !safeIdentifier.test(row.task_type)
        )
          throw new OperationalLogError();
        return Object.freeze({
          taskId: row.task_id,
          revision: row.revision,
          taskType: row.task_type,
          taskState: member<TaskState>(row.task_state, taskStates),
          updatedAt: iso(row.updated_at),
        });
      });
    });
  }

  private run(row: StateRow): OperationalRunSummary {
    if (
      row.run_id === undefined ||
      !runIdPattern.test(row.run_id) ||
      row.started_at === undefined
    )
      throw new OperationalLogError();
    return Object.freeze({
      ...summary(row),
      runId: row.run_id,
      startedAt: iso(row.started_at),
    });
  }

  private async query<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof OperationalLogError) throw error;
      throw new OperationalLogError();
    }
  }
}
