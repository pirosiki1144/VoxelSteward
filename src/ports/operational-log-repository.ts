import type {
  MinecraftConnectionState,
  RuntimeState,
  TaskState,
} from "../domain/state/index.js";

export type OperationalCause =
  | "runtime.transition"
  | "minecraft.connection.transition"
  | "minecraft.spawn.update"
  | "minecraft.telemetry.update"
  | "minecraft.telemetry.invalidate"
  | "safety.other_player_detected"
  | "task.prepare"
  | "task.transition"
  | "task.progress.update"
  | "task.reset"
  | "runtime.stop_reason.record"
  | "runtime.error.record"
  | "unknown";

export interface OperationalStateSummary {
  readonly revision: number;
  readonly updatedAt: string;
  readonly runtime: RuntimeState;
  readonly minecraftConnection: MinecraftConnectionState;
  readonly spawnCompleted: boolean;
  readonly telemetryStatus: "unknown" | "valid" | "invalid";
  readonly position?: Readonly<{ x: number; y: number; z: number }>;
  readonly dimension?: "overworld" | "nether" | "end";
  readonly health?: number;
  readonly hunger?: number;
  readonly otherPlayerDetected: boolean;
  readonly task?: Readonly<{
    id: string;
    type: string;
    state: TaskState;
    updatedAt: string;
  }>;
  readonly stopReason?: string;
  readonly lastErrorCode?: string;
}

export interface OperationalRunSummary extends OperationalStateSummary {
  readonly runId: string;
  readonly startedAt: string;
}

export interface OperationalHistoryEntry extends OperationalStateSummary {
  readonly occurredAt: string;
  readonly cause: OperationalCause;
}

export interface OperationalCheckpointSummary {
  readonly taskId: string;
  readonly revision: number;
  readonly taskType: string;
  readonly taskState: TaskState;
  readonly updatedAt: string;
}

export interface OperationalLogRepository {
  listRuns(limit: number): Promise<readonly OperationalRunSummary[]>;
  findRun(runId: string): Promise<OperationalRunSummary | undefined>;
  listHistory(
    runId: string,
    afterRevision: number,
    limit: number,
  ): Promise<readonly OperationalHistoryEntry[]>;
  listCheckpoints(
    runId: string,
    limit: number,
  ): Promise<readonly OperationalCheckpointSummary[]>;
}

export class OperationalLogError extends Error {
  override readonly name = "OperationalLogError";
  readonly code = "OPERATIONAL_LOG_UNAVAILABLE";
  constructor() {
    super("Operational log is unavailable");
  }
}
