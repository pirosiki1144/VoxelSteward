import type { StateCommand } from "./commands.js";
import {
  InvalidStateCommandError,
  InvalidStateTransitionError,
} from "./errors.js";
import {
  assertFiniteTelemetry,
  assertMinecraftTransition,
  assertNonEmpty,
  assertProgress,
  assertRuntimeTransition,
  assertTaskTransition,
} from "./transitions.js";
import type {
  Clock,
  MinecraftState,
  StateChangeEvent,
  StateChangeListener,
  StateSnapshot,
  StateStore,
  SubscriberErrorReporter,
} from "./types.js";

const systemClock: Clock = { now: () => new Date() };
const terminalTaskStates = new Set(["completed", "failed", "stopped"]);

const deepFreeze = <Value>(value: Value): Value => {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const samePosition = (
  left: MinecraftState["position"],
  right: MinecraftState["position"],
): boolean =>
  left === right ||
  (left !== undefined &&
    right !== undefined &&
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z);

const copySnapshot = (snapshot: StateSnapshot): StateSnapshot => ({
  ...snapshot,
  minecraft: {
    ...snapshot.minecraft,
    ...(snapshot.minecraft.position === undefined
      ? {}
      : { position: { ...snapshot.minecraft.position } }),
  },
  task: { ...snapshot.task },
  ...(snapshot.lastError === undefined
    ? {}
    : { lastError: { ...snapshot.lastError } }),
});

interface Subscription {
  active: boolean;
  readonly listener: StateChangeListener;
}

export interface StateStoreOptions {
  readonly clock?: Clock;
  readonly onSubscriberError?: SubscriberErrorReporter;
}

export class InMemoryStateStore implements StateStore {
  readonly #clock: Clock;
  readonly #onSubscriberError: SubscriberErrorReporter;
  readonly #subscriptions = new Set<Subscription>();
  #snapshot: StateSnapshot;

  constructor(options: StateStoreOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#onSubscriberError = options.onSubscriberError ?? (() => undefined);
    const initializedAt = this.#utcNow();
    this.#snapshot = deepFreeze({
      revision: 0,
      updatedAt: initializedAt,
      runtime: "starting",
      minecraft: {
        connection: "disconnected",
        spawnCompleted: false,
        telemetryStatus: "unknown",
        otherPlayerDetected: false,
      },
      task: {
        state: "idle",
        updatedAt: initializedAt,
      },
    });
  }

  getSnapshot(): StateSnapshot {
    return this.#snapshot;
  }

  dispatch(command: StateCommand): StateChangeEvent | undefined {
    const before = this.#snapshot;
    const draft = copySnapshot(before);
    const changedFields = this.#apply(draft, command);
    if (changedFields.length === 0) return undefined;

    const occurredAt = this.#utcNow();
    let task = draft.task;
    if (command.type.startsWith("task.")) {
      task = { ...draft.task, updatedAt: occurredAt };
    }
    if (
      command.type === "task.transition" &&
      command.to === "running" &&
      before.task.startedAt === undefined
    ) {
      task = { ...task, startedAt: occurredAt };
    }
    if (
      command.type === "task.transition" &&
      terminalTaskStates.has(command.to)
    ) {
      task = { ...task, finishedAt: occurredAt };
    }
    const after = deepFreeze({
      ...draft,
      revision: before.revision + 1,
      updatedAt: occurredAt,
      task,
      ...(command.type === "runtime.error.record"
        ? {
            lastError: {
              ...command.error,
              occurredAt,
            },
          }
        : {}),
    });
    const event = deepFreeze({
      revision: after.revision,
      occurredAt,
      cause: command.type,
      before,
      after,
      changedFields: [...changedFields],
    } satisfies StateChangeEvent);
    this.#snapshot = after;
    this.#notify(event);
    return event;
  }

  subscribe(listener: StateChangeListener): () => void {
    const subscription: Subscription = { active: true, listener };
    this.#subscriptions.add(subscription);
    return () => {
      subscription.active = false;
      this.#subscriptions.delete(subscription);
    };
  }

  #apply(draft: StateSnapshot, command: StateCommand): string[] {
    switch (command.type) {
      case "runtime.transition":
        if (draft.runtime === command.to) return [];
        if (
          draft.minecraft.otherPlayerDetected &&
          (command.to === "connecting" ||
            command.to === "ready" ||
            command.to === "reconnecting")
        ) {
          throw new InvalidStateTransitionError(
            "runtime after player detection",
            draft.runtime,
            command.to,
          );
        }
        assertRuntimeTransition(draft.runtime, command.to);
        Object.assign(draft, { runtime: command.to });
        return ["runtime"];

      case "minecraft.connection.transition": {
        if (draft.minecraft.connection === command.to) return [];
        assertMinecraftTransition(draft.minecraft.connection, command.to);
        const disconnected = command.to === "disconnected";
        Object.assign(draft, {
          minecraft: {
            ...draft.minecraft,
            connection: command.to,
            ...(disconnected
              ? {
                  spawnCompleted: false,
                  telemetryStatus: "unknown",
                  position: undefined,
                  health: undefined,
                  hunger: undefined,
                }
              : {}),
          },
        });
        return disconnected
          ? [
              "minecraft.connection",
              "minecraft.spawnCompleted",
              "minecraft.telemetryStatus",
              "minecraft.position",
              "minecraft.health",
              "minecraft.hunger",
            ]
          : ["minecraft.connection"];
      }

      case "minecraft.spawn.update":
        if (draft.minecraft.spawnCompleted === command.completed) return [];
        if (!command.completed) {
          throw new InvalidStateCommandError(
            "Spawn completion is cleared by disconnecting",
          );
        }
        if (draft.minecraft.connection !== "connected") {
          throw new InvalidStateTransitionError(
            "spawn",
            draft.minecraft.connection,
            "spawned",
          );
        }
        Object.assign(draft, {
          minecraft: {
            ...draft.minecraft,
            spawnCompleted: command.completed,
            connection: "spawned",
          },
        });
        return ["minecraft.spawnCompleted", "minecraft.connection"];

      case "minecraft.telemetry.update": {
        const { position, health, hunger } = command.telemetry;
        assertFiniteTelemetry(health, "health");
        assertFiniteTelemetry(hunger, "hunger");
        if (position !== undefined) {
          assertFiniteTelemetry(position.x, "position.x");
          assertFiniteTelemetry(position.y, "position.y");
          assertFiniteTelemetry(position.z, "position.z");
        }
        const changed: string[] = [];
        const telemetryWasValid = draft.minecraft.telemetryStatus === "valid";
        if (
          position !== undefined &&
          !samePosition(draft.minecraft.position, position)
        ) {
          changed.push("minecraft.position");
        }
        if (health !== undefined && health !== draft.minecraft.health) {
          changed.push("minecraft.health");
        }
        if (hunger !== undefined && hunger !== draft.minecraft.hunger) {
          changed.push("minecraft.hunger");
        }
        if (!telemetryWasValid) changed.push("minecraft.telemetryStatus");
        if (changed.length === 0) return [];
        Object.assign(draft, {
          minecraft: {
            ...draft.minecraft,
            telemetryStatus: "valid",
            ...(position === undefined ? {} : { position: { ...position } }),
            ...(health === undefined ? {} : { health }),
            ...(hunger === undefined ? {} : { hunger }),
          },
        });
        return changed;
      }

      case "minecraft.telemetry.invalidate":
        if (draft.minecraft.telemetryStatus === "invalid") return [];
        Object.assign(draft, {
          minecraft: {
            ...draft.minecraft,
            telemetryStatus: "invalid",
            position: undefined,
            health: undefined,
            hunger: undefined,
          },
        });
        return [
          "minecraft.telemetryStatus",
          "minecraft.position",
          "minecraft.health",
          "minecraft.hunger",
        ];

      case "safety.other_player_detected":
        if (draft.minecraft.otherPlayerDetected) return [];
        if (draft.runtime !== "connecting" && draft.runtime !== "ready") {
          throw new InvalidStateTransitionError(
            "player detection",
            draft.runtime,
            "stopping",
          );
        }
        Object.assign(draft, {
          runtime: "stopping",
          minecraft: { ...draft.minecraft, otherPlayerDetected: true },
          stopReason: "other_player_detected",
        });
        return ["minecraft.otherPlayerDetected", "stopReason", "runtime"];

      case "task.prepare":
        assertTaskTransition(draft.task.state, "preparing");
        assertNonEmpty(command.taskId, "taskId");
        assertNonEmpty(command.taskType, "taskType");
        Object.assign(draft, {
          task: {
            state: "preparing",
            id: command.taskId,
            type: command.taskType,
            updatedAt: draft.task.updatedAt,
            progress: 0,
          },
        });
        return ["task"];

      case "task.transition": {
        assertTaskTransition(draft.task.state, command.to);
        Object.assign(draft, {
          task: {
            ...draft.task,
            state: command.to,
          },
        });
        return ["task.state"];
      }

      case "task.progress.update":
        assertProgress(command.progress);
        if (draft.task.state !== "running" && draft.task.state !== "paused") {
          throw new InvalidStateCommandError(
            "Task progress requires a running or paused task",
          );
        }
        if (
          draft.task.progress === command.progress &&
          draft.task.progressMessage === command.message
        ) {
          return [];
        }
        Object.assign(draft, {
          task: {
            ...draft.task,
            progress: command.progress,
            ...(command.message === undefined
              ? { progressMessage: undefined }
              : { progressMessage: command.message }),
          },
        });
        return ["task.progress"];

      case "task.reset":
        if (!terminalTaskStates.has(draft.task.state)) {
          throw new InvalidStateTransitionError(
            "task reset",
            draft.task.state,
            "idle",
          );
        }
        Object.assign(draft, {
          task: { state: "idle", updatedAt: draft.task.updatedAt },
        });
        return ["task"];

      case "runtime.stop_reason.record":
        assertNonEmpty(command.reason, "stop reason");
        if (draft.stopReason === command.reason) return [];
        Object.assign(draft, { stopReason: command.reason });
        return ["stopReason"];

      case "runtime.error.record":
        assertNonEmpty(command.error.message, "sanitized error message");
        return ["lastError"];
    }
  }

  #utcNow(): string {
    const value = this.#clock.now();
    if (Number.isNaN(value.getTime())) {
      throw new InvalidStateCommandError("Clock returned an invalid date");
    }
    return value.toISOString();
  }

  #notify(event: StateChangeEvent): void {
    const subscriptions = [...this.#subscriptions];
    queueMicrotask(() => {
      for (const subscription of subscriptions) {
        if (!subscription.active) continue;
        try {
          const result = subscription.listener(event);
          void Promise.resolve(result).catch((error: unknown) => {
            this.#reportSubscriberError(error);
          });
        } catch (error) {
          this.#reportSubscriberError(error);
        }
      }
    });
  }

  #reportSubscriberError(error: unknown): void {
    try {
      this.#onSubscriberError(error);
    } catch {
      // Error reporting must never affect state delivery or runtime safety.
    }
  }
}

export const createStateStore = (
  options: StateStoreOptions = {},
): InMemoryStateStore => new InMemoryStateStore(options);
