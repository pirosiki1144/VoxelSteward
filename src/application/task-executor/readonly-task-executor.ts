import { SimpleWorkCoordinator } from "../simple-work/index.js";
import type { SafetyControlledTaskQueue } from "../safety/index.js";
import type { TaskQueueService } from "../task-queue/index.js";
import type { StateStore } from "../../domain/state/index.js";
import type {
  RecordPositionInstruction,
  VerifyArrivalInstruction,
} from "../../domain/simple-work/index.js";
import type { TaskQueueItem } from "../../domain/task-queue/index.js";

const allowedTaskTypes = Object.freeze(["verify_arrival", "record_position"]);
const claimLeaseDurationMs = 30_000;

export type ReadonlyTaskExecutorErrorReporter = (
  code: "TASK_EXECUTION_FAILED" | "TASK_STATE_UPDATE_FAILED",
) => void;

export interface ReadonlyTaskExecutorOptions {
  readonly queue: TaskQueueService;
  readonly safeQueue: SafetyControlledTaskQueue;
  readonly stateStore: StateStore;
  readonly pollIntervalMs?: number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly onError?: ReadonlyTaskExecutorErrorReporter;
  readonly coordinator?: Pick<SimpleWorkCoordinator, "execute">;
}

const defaultWait = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });

export class ReadonlyTaskExecutor {
  readonly #queue: TaskQueueService;
  readonly #safeQueue: SafetyControlledTaskQueue;
  readonly #stateStore: StateStore;
  readonly #pollIntervalMs: number;
  readonly #wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly #onError: ReadonlyTaskExecutorErrorReporter;
  readonly #abort = new AbortController();
  readonly #coordinator: Pick<SimpleWorkCoordinator, "execute">;
  readonly #workerId: string;
  #loop: Promise<void> | undefined;
  #activeTaskId: string | undefined;
  #closed = false;

  constructor(options: ReadonlyTaskExecutorOptions) {
    this.#queue = options.queue;
    this.#safeQueue = options.safeQueue;
    this.#stateStore = options.stateStore;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#wait = options.wait ?? defaultWait;
    this.#onError = options.onError ?? (() => undefined);
    this.#workerId = `readonly-${Math.random().toString(36).slice(2, 14)}`;
    if (!Number.isSafeInteger(this.#pollIntervalMs) || this.#pollIntervalMs < 1)
      throw new RangeError("pollIntervalMs must be a positive integer");
    this.#coordinator =
      options.coordinator ??
      new SimpleWorkCoordinator({
        movement: {
          execute: () => {
            throw new Error("Movement is disabled for the read-only executor");
          },
        },
        readPosition: () => {
          const minecraft = this.#stateStore.getSnapshot().minecraft;
          if (
            minecraft.position === undefined ||
            minecraft.dimension === undefined
          )
            return undefined;
          return Object.freeze({
            ...minecraft.position,
            dimension: minecraft.dimension,
          });
        },
      });
  }

  start(): void {
    if (this.#closed || this.#loop !== undefined) return;
    this.#loop = this.#runLoop();
  }

  async processNext(): Promise<boolean> {
    if (this.#closed) return false;
    const result = await this.#safeQueue.claimNext(allowedTaskTypes, {
      owner: this.#workerId,
      leaseDurationMs: claimLeaseDurationMs,
    });
    if (result.item === undefined) return false;
    await this.#execute(result.item);
    return true;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    const active = this.#activeTaskId;
    if (active !== undefined) {
      await this.#safeQueue
        .stop(active)
        .catch(() => this.#report("TASK_EXECUTION_FAILED"));
      this.#transitionTask("stopped");
    }
    await this.#loop;
  }

  async #runLoop(): Promise<void> {
    while (!this.#closed) {
      try {
        await this.processNext();
      } catch {
        this.#report("TASK_EXECUTION_FAILED");
      }
      if (!this.#closed)
        await this.#wait(this.#pollIntervalMs, this.#abort.signal);
    }
  }

  async #execute(item: TaskQueueItem): Promise<void> {
    this.#activeTaskId = item.taskId;
    try {
      const instruction = this.#instruction(item);
      const currentTask = this.#stateStore.getSnapshot().task.state;
      if (["completed", "failed", "stopped"].includes(currentTask))
        this.#dispatch({ type: "task.reset" });
      this.#dispatch({
        type: "task.prepare",
        taskId: item.taskId,
        taskType: item.taskType,
      });
      this.#dispatch({ type: "task.transition", to: "running" });
      const before = await this.#safeQueue.enforceContinuation(item.taskId);
      if (before.decision.disposition === "stop") {
        this.#transitionTask("stopped");
        return;
      }
      const result = await this.#coordinator.execute(instruction);
      const after = await this.#safeQueue.enforceContinuation(item.taskId);
      if (after.decision.disposition === "stop") {
        this.#transitionTask("stopped");
        return;
      }
      if (result.outcome === "completed") {
        this.#dispatch({
          type: "task.progress.update",
          progress: 1,
          message:
            result.taskType === "verify_arrival"
              ? result.arrived
                ? "arrival_verified"
                : "arrival_not_verified"
              : "position_recorded",
        });
        await this.#queue.dispatch({
          type: "task.finish",
          taskId: item.taskId,
          outcome: "completed",
        });
        this.#transitionTask("completed");
      } else {
        await this.#queue.dispatch({
          type: "task.finish",
          taskId: item.taskId,
          outcome: "failed",
        });
        this.#transitionTask("failed");
      }
    } catch {
      await this.#queue
        .dispatch({
          type: "task.finish",
          taskId: item.taskId,
          outcome: "failed",
        })
        .catch(() => undefined);
      this.#transitionTask("failed");
      this.#report("TASK_EXECUTION_FAILED");
    } finally {
      this.#activeTaskId = undefined;
    }
  }

  #instruction(
    item: TaskQueueItem,
  ): VerifyArrivalInstruction | RecordPositionInstruction {
    if (
      item.details?.kind !== "verify_arrival" &&
      item.details?.kind !== "record_position"
    )
      throw new Error("Unsupported task type");
    return item.details.instruction;
  }

  #transitionTask(to: "completed" | "failed" | "stopped"): void {
    const current = this.#stateStore.getSnapshot().task.state;
    if (current === to || ["completed", "failed", "stopped"].includes(current))
      return;
    this.#dispatch({ type: "task.transition", to });
  }

  #dispatch(command: Parameters<StateStore["dispatch"]>[0]): void {
    try {
      this.#stateStore.dispatch(command);
    } catch {
      this.#report("TASK_STATE_UPDATE_FAILED");
      throw new Error("Task state update failed");
    }
  }

  #report(code: "TASK_EXECUTION_FAILED" | "TASK_STATE_UPDATE_FAILED"): void {
    try {
      this.#onError(code);
    } catch {
      // Error observation must not affect runtime safety.
    }
  }
}
