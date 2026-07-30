import {
  InvalidStateCommandError,
  InvalidStateTransitionError,
} from "./errors.js";
import type {
  MinecraftConnectionState,
  RuntimeState,
  TaskState,
} from "./types.js";

const runtimeTransitions: Readonly<
  Record<RuntimeState, ReadonlySet<RuntimeState>>
> = {
  starting: new Set(["connecting", "stopping"]),
  connecting: new Set(["ready", "reconnecting", "stopping", "failed"]),
  ready: new Set(["reconnecting", "stopping", "failed"]),
  reconnecting: new Set(["connecting", "stopping", "failed"]),
  stopping: new Set(["stopped", "failed"]),
  stopped: new Set(),
  failed: new Set(),
};

const minecraftTransitions: Readonly<
  Record<MinecraftConnectionState, ReadonlySet<MinecraftConnectionState>>
> = {
  disconnected: new Set(["connecting"]),
  connecting: new Set(["connected", "disconnected"]),
  connected: new Set(["spawned", "disconnected"]),
  spawned: new Set(["disconnected"]),
};

const taskTransitions: Readonly<Record<TaskState, ReadonlySet<TaskState>>> = {
  idle: new Set(["preparing"]),
  preparing: new Set(["running", "failed", "stopped"]),
  running: new Set(["paused", "completed", "failed", "stopped"]),
  paused: new Set(["running", "failed", "stopped"]),
  completed: new Set(),
  failed: new Set(),
  stopped: new Set(),
};

export const assertRuntimeTransition = (
  from: RuntimeState,
  to: RuntimeState,
): void => {
  if (!runtimeTransitions[from].has(to)) {
    throw new InvalidStateTransitionError("runtime", from, to);
  }
};

export const assertMinecraftTransition = (
  from: MinecraftConnectionState,
  to: MinecraftConnectionState,
): void => {
  if (!minecraftTransitions[from].has(to)) {
    throw new InvalidStateTransitionError("minecraft", from, to);
  }
};

export const assertTaskTransition = (from: TaskState, to: TaskState): void => {
  if (!taskTransitions[from].has(to)) {
    throw new InvalidStateTransitionError("task", from, to);
  }
};

export const assertProgress = (progress: number): void => {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new InvalidStateCommandError(
      "Task progress must be a finite number from 0 through 1",
    );
  }
};

export const assertNonEmpty = (value: string, field: string): void => {
  if (value.trim() === "") {
    throw new InvalidStateCommandError(`${field} must not be empty`);
  }
};

export const assertFiniteTelemetry = (
  value: number | undefined,
  field: string,
): void => {
  if (value !== undefined && !Number.isFinite(value)) {
    throw new InvalidStateCommandError(`${field} must be finite`);
  }
};
