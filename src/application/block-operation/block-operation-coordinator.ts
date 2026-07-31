import {
  blockDistance,
  BlockOperationError,
  validateBlockObservation,
  validateBlockOperationInstruction,
  type BlockObservation,
  type BlockOperationInstruction,
  type BlockOperationProgress,
  type BlockOperationProgressListener,
  type BlockOperationResult,
  type BlockPosition,
} from "../../domain/block-operation/index.js";
import type { WorkSafetyPolicy } from "../../domain/safety/index.js";
import type { StateStore } from "../../domain/state/index.js";
import {
  BlockOperationPortError,
  type BlockOperationPort,
} from "../../ports/block-operation-port.js";
import type { TaskQueueService } from "../task-queue/index.js";

export type BlockOperationWait = (
  delayMs: number,
  signal: AbortSignal,
) => Promise<void>;

const defaultWait: BlockOperationWait = (delayMs, signal) =>
  new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });

export interface BlockOperationCoordinatorOptions {
  readonly port: BlockOperationPort;
  readonly stateStore: StateStore;
  readonly safetyPolicy: WorkSafetyPolicy;
  readonly taskQueue: TaskQueueService;
  readonly wait?: BlockOperationWait;
}

type PortResult<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "timeout" | "cancelled" }
  | {
      readonly kind: "error";
      readonly reason: "unsupported_adapter" | "disconnected" | "port_error";
    };

export class BlockOperationCoordinator {
  readonly #port: BlockOperationPort;
  readonly #stateStore: StateStore;
  readonly #safetyPolicy: WorkSafetyPolicy;
  readonly #taskQueue: TaskQueueService;
  readonly #wait: BlockOperationWait;
  #active:
    | { readonly taskId: string; readonly controller: AbortController }
    | undefined;
  #portStopped = false;
  #safetyStopped = false;

  constructor(options: BlockOperationCoordinatorOptions) {
    this.#port = options.port;
    this.#stateStore = options.stateStore;
    this.#safetyPolicy = options.safetyPolicy;
    this.#taskQueue = options.taskQueue;
    this.#wait = options.wait ?? defaultWait;
  }

  async execute(
    instruction: BlockOperationInstruction,
    onProgress?: BlockOperationProgressListener,
  ): Promise<BlockOperationResult> {
    if (this.#active !== undefined) {
      throw new BlockOperationError("BLOCK_OPERATION_ALREADY_ACTIVE");
    }
    const report = (progress: BlockOperationProgress): void => {
      try {
        onProgress?.(Object.freeze(progress));
      } catch {
        // Progress reporting cannot affect safety or finalization.
      }
    };
    try {
      validateBlockOperationInstruction(instruction);
    } catch {
      report({ phase: "failed", progress: 0 });
      return Object.freeze({
        outcome: "failed",
        reason: "invalid_instruction",
      });
    }

    const command = Object.freeze({
      ...instruction,
      target: Object.freeze({ ...instruction.target }),
      support: Object.freeze({
        ...instruction.support,
        position: Object.freeze({ ...instruction.support.position }),
      }),
    }) satisfies BlockOperationInstruction;

    const controller = new AbortController();
    this.#active = { taskId: command.taskId, controller };
    this.#portStopped = false;
    this.#safetyStopped = false;
    const unsubscribe = this.#stateStore.subscribe(() => {
      if (
        this.#safetyPolicy.evaluate(this.#stateStore.getSnapshot(), "continue")
          .disposition !== "allow"
      ) {
        this.#safetyStopped = true;
        controller.abort();
        this.#stopPortOnce();
      }
    });
    let finalizationAttempted = false;
    const finalize = async (
      outcome: "completed" | "failed" | "stopped",
    ): Promise<void> => {
      finalizationAttempted = true;
      await this.#finalize(command.taskId, outcome);
    };
    try {
      const claimed = await this.#taskQueue.find(command.taskId);
      if (
        claimed?.status !== "claimed" ||
        claimed.taskType !== command.taskType ||
        claimed.maxAttempts !== 1 ||
        claimed.attempts !== 1
      ) {
        return Object.freeze({ outcome: "failed", reason: "task_not_claimed" });
      }
      const initialSnapshot = this.#stateStore.getSnapshot();
      if (initialSnapshot.task.state !== "idle") {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "task_state_conflict",
        });
      }
      if (
        this.#safetyPolicy.evaluate(initialSnapshot, "start").disposition !==
        "allow"
      ) {
        this.#stopPortOnce();
        await finalize("stopped");
        return Object.freeze({ outcome: "stopped", reason: "safety_stop" });
      }
      const position = initialSnapshot.minecraft.position;
      const dimension = initialSnapshot.minecraft.dimension;
      if (position === undefined || dimension === undefined) {
        await finalize("failed");
        return Object.freeze({ outcome: "failed", reason: "invalid_position" });
      }
      const playerPosition: BlockPosition = { ...position, dimension };
      if (
        command.target.dimension !== dimension ||
        blockDistance(playerPosition, command.target) > command.maxReach
      ) {
        await finalize("failed");
        return Object.freeze({ outcome: "failed", reason: "out_of_reach" });
      }
      if (this.#port.capability !== "supported") {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unsupported_adapter",
        });
      }

      report({ phase: "validated", progress: 0 });
      report({ phase: "observing", progress: 0 });
      const before = await this.#invoke(
        (signal) => this.#port.observe(command.target, signal),
        command.timeoutMs,
        controller.signal,
      );
      const beforeFailure = await this.#portFailure(before, finalize);
      if (beforeFailure !== undefined) return beforeFailure;
      if (before.kind !== "value") {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unexpected_before",
        });
      }
      try {
        validateBlockObservation(before.value);
      } catch {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unexpected_before",
        });
      }
      if (
        !this.#matches(before.value, command.target) ||
        before.value.blockType !== command.expectedBefore
      ) {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unexpected_before",
        });
      }

      const support = await this.#invoke(
        (signal) => this.#port.observe(command.support.position, signal),
        command.timeoutMs,
        controller.signal,
      );
      const supportFailure = await this.#portFailure(support, finalize);
      if (supportFailure !== undefined) return supportFailure;
      if (support.kind !== "value") {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unsupported_support",
        });
      }
      try {
        validateBlockObservation(support.value);
      } catch {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unsupported_support",
        });
      }
      if (
        !this.#matches(support.value, command.support.position) ||
        support.value.blockType === "air"
      ) {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "unsupported_support",
        });
      }

      // Re-evaluate immediately before the only world-changing call.
      if (
        this.#safetyPolicy.evaluate(this.#stateStore.getSnapshot(), "continue")
          .disposition !== "allow"
      ) {
        this.#stopPortOnce();
        await finalize("stopped");
        return Object.freeze({ outcome: "stopped", reason: "safety_stop" });
      }

      this.#stateStore.dispatch({
        type: "task.prepare",
        taskId: command.taskId,
        taskType: command.taskType,
      });
      this.#stateStore.dispatch({ type: "task.transition", to: "running" });
      report({ phase: "placing", progress: 0.5 });
      const placed = await this.#invoke(
        async (signal) => {
          if (signal.aborted || controller.signal.aborted) {
            throw new BlockOperationPortError("operation_failed");
          }
          if (
            this.#safetyPolicy.evaluate(
              this.#stateStore.getSnapshot(),
              "continue",
            ).disposition !== "allow"
          ) {
            this.#safetyStopped = true;
            controller.abort();
            this.#stopPortOnce();
            throw new BlockOperationPortError("operation_failed");
          }
          await this.#port.place(command, signal);
        },
        command.timeoutMs,
        controller.signal,
      );
      const placeFailure = await this.#portFailure(placed, finalize);
      if (placeFailure !== undefined) return placeFailure;
      if (controller.signal.aborted) {
        this.#stopPortOnce();
        await finalize("stopped");
        return Object.freeze({ outcome: "stopped", reason: "cancelled" });
      }

      const afterSafety = this.#safetyPolicy.evaluate(
        this.#stateStore.getSnapshot(),
        "continue",
      );
      if (afterSafety.disposition !== "allow") {
        this.#stopPortOnce();
        await finalize("stopped");
        return Object.freeze({ outcome: "stopped", reason: "safety_stop" });
      }
      const after = await this.#invoke(
        (signal) => this.#port.observe(command.target, signal),
        command.timeoutMs,
        controller.signal,
      );
      const afterFailure = await this.#portFailure(after, finalize);
      if (afterFailure !== undefined) return afterFailure;
      if (after.kind !== "value") {
        await finalize("failed");
        return Object.freeze({ outcome: "failed", reason: "unexpected_after" });
      }
      try {
        validateBlockObservation(after.value);
      } catch {
        await finalize("failed");
        return Object.freeze({ outcome: "failed", reason: "unexpected_after" });
      }
      if (
        !this.#matches(after.value, command.target) ||
        after.value.blockType !== command.expectedAfter
      ) {
        await finalize("failed");
        return Object.freeze({ outcome: "failed", reason: "unexpected_after" });
      }
      await finalize("completed");
      report({ phase: "completed", progress: 1 });
      return Object.freeze({
        outcome: "completed",
        observation: Object.freeze({
          position: Object.freeze({ ...after.value.position }),
          blockType: after.value.blockType,
        }),
      });
    } catch {
      this.#stopPortOnce();
      if (finalizationAttempted) {
        report({ phase: "failed", progress: 0 });
        return Object.freeze({
          outcome: "failed",
          reason: "finalization_error",
        });
      }
      try {
        await finalize("failed");
      } catch {
        report({ phase: "failed", progress: 0 });
        return Object.freeze({
          outcome: "failed",
          reason: "finalization_error",
        });
      }
      report({ phase: "failed", progress: 0 });
      return Object.freeze({ outcome: "failed", reason: "port_error" });
    } finally {
      unsubscribe();
      controller.abort();
      if (this.#active?.taskId === command.taskId) this.#active = undefined;
    }
  }

  cancel(): void {
    const active = this.#active;
    if (active === undefined || active.controller.signal.aborted) return;
    active.controller.abort();
    this.#stopPortOnce();
  }

  async #portFailure<T>(
    result: PortResult<T>,
    finalize: (outcome: "failed" | "stopped") => Promise<void>,
  ): Promise<BlockOperationResult | undefined> {
    if (result.kind === "value") return undefined;
    this.#stopPortOnce();
    if (result.kind === "cancelled") {
      await finalize("stopped");
      return Object.freeze({
        outcome: "stopped",
        reason: this.#safetyStopped ? "safety_stop" : "cancelled",
      });
    }
    await finalize("failed");
    return Object.freeze({
      outcome: "failed",
      reason:
        result.kind === "timeout"
          ? "timeout"
          : result.kind === "error"
            ? result.reason
            : "port_error",
    });
  }

  async #invoke<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    parentSignal: AbortSignal,
  ): Promise<PortResult<T>> {
    if (parentSignal.aborted) return { kind: "cancelled" };
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    parentSignal.addEventListener("abort", abort, { once: true });
    try {
      const request: Promise<PortResult<T>> = Promise.resolve()
        .then(() => {
          if (parentSignal.aborted || controller.signal.aborted) {
            return Promise.reject(
              new BlockOperationPortError("operation_failed"),
            );
          }
          return operation(controller.signal);
        })
        .then((value) => ({ kind: "value" as const, value }))
        .catch((error: unknown) => {
          if (parentSignal.aborted) return { kind: "cancelled" as const };
          const reason =
            error instanceof BlockOperationPortError
              ? error.code === "unsupported"
                ? "unsupported_adapter"
                : error.code === "disconnected"
                  ? "disconnected"
                  : "port_error"
              : "port_error";
          return { kind: "error" as const, reason };
        });
      const timeout = this.#wait(timeoutMs, controller.signal).then<
        PortResult<T>
      >(() => {
        if (parentSignal.aborted) return { kind: "cancelled" };
        controller.abort();
        return { kind: "timeout" };
      });
      return await Promise.race([request, timeout]);
    } finally {
      parentSignal.removeEventListener("abort", abort);
      controller.abort();
    }
  }

  #matches(observation: BlockObservation, position: BlockPosition): boolean {
    return (
      observation.position.x === position.x &&
      observation.position.y === position.y &&
      observation.position.z === position.z &&
      observation.position.dimension === position.dimension
    );
  }

  #stopPortOnce(): void {
    if (this.#portStopped) return;
    this.#portStopped = true;
    try {
      this.#port.stop();
    } catch {
      // Cleanup failure cannot prevent queue finalization.
    }
  }

  async #finalize(
    taskId: string,
    outcome: "completed" | "failed" | "stopped",
  ): Promise<void> {
    const stateTask = this.#stateStore.getSnapshot().task;
    if (
      stateTask.id === taskId &&
      ["preparing", "running", "paused"].includes(stateTask.state)
    ) {
      this.#stateStore.dispatch({ type: "task.transition", to: outcome });
    }
    await this.#taskQueue.dispatch({ type: "task.finish", taskId, outcome });
  }
}
