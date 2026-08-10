export type RuntimeState =
  | "starting"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "stopping"
  | "stopped"
  | "failed";

export type MinecraftConnectionState =
  "disconnected" | "connecting" | "connected" | "spawned";

export type TaskState =
  | "idle"
  | "preparing"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export interface Position {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MinecraftState {
  readonly connection: MinecraftConnectionState;
  readonly spawnCompleted: boolean;
  readonly telemetryStatus: "unknown" | "valid" | "invalid";
  readonly position?: Position;
  readonly dimension?: "overworld" | "nether" | "end";
  readonly health?: number;
  readonly hunger?: number;
  readonly otherPlayerDetected: boolean;
}

export interface TaskProgressState {
  readonly id?: string;
  readonly type?: string;
  readonly state: TaskState;
  readonly startedAt?: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
  readonly progress?: number;
  readonly progressMessage?: string;
}

export interface ScheduleRuntimeState {
  readonly phase: import("../scheduler/index.js").SchedulePhase;
  readonly intent: import("../scheduler/index.js").ScheduleIntent["type"];
  readonly window: import("../scheduler/index.js").OperatingWindow;
  readonly evaluatedAt: string;
}

export type SanitizedErrorCode =
  "connection_error" | "reconnect_exhausted" | "internal_error";

export interface SanitizedError {
  readonly code: SanitizedErrorCode;
  readonly message: string;
}

export interface RecordedError extends SanitizedError {
  readonly occurredAt: string;
}

export interface StateSnapshot {
  readonly revision: number;
  readonly updatedAt: string;
  readonly runtime: RuntimeState;
  readonly minecraft: MinecraftState;
  readonly task: TaskProgressState;
  readonly schedule?: ScheduleRuntimeState;
  readonly stopReason?: string;
  readonly lastError?: RecordedError;
}

export interface Clock {
  now(): Date;
}

export interface StateChangeEvent {
  readonly revision: number;
  readonly occurredAt: string;
  readonly cause: import("./commands.js").StateCommand["type"];
  readonly before: StateSnapshot;
  readonly after: StateSnapshot;
  readonly changedFields: readonly string[];
}

export type StateChangeListener = (
  event: StateChangeEvent,
) => void | Promise<void>;

export type SubscriberErrorReporter = (error: unknown) => void;

export interface StateStore {
  getSnapshot(): StateSnapshot;
  dispatch(
    command: import("./commands.js").StateCommand,
  ): StateChangeEvent | undefined;
  subscribe(listener: StateChangeListener): () => void;
}
