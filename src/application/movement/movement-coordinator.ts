import {
  createMovementPlan,
  isWithinArrivalTolerance,
  MovementError,
  validateMovementPosition,
  type MovementCommand,
  type MovementPosition,
  type MovementResult,
} from "../../domain/movement/index.js";
import type { StateStore } from "../../domain/state/index.js";
import type { WorkSafetyPolicy } from "../../domain/safety/index.js";
import type { MovementPort } from "../../ports/movement-port.js";
import type { TaskQueueService } from "../task-queue/index.js";

export type MovementWait = (
  delayMs: number,
  signal: AbortSignal,
) => Promise<void>;

const defaultWait: MovementWait = (delayMs, signal) =>
  new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });

type StepOutcome =
  | { readonly kind: "position"; readonly position: MovementPosition }
  | { readonly kind: "timeout" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error" };

export interface MovementCoordinatorOptions {
  readonly port: MovementPort;
  readonly stateStore: StateStore;
  readonly safetyPolicy: WorkSafetyPolicy;
  readonly taskQueue: TaskQueueService;
  readonly wait?: MovementWait;
}

export class MovementCoordinator {
  readonly #port: MovementPort;
  readonly #stateStore: StateStore;
  readonly #safetyPolicy: WorkSafetyPolicy;
  readonly #taskQueue: TaskQueueService;
  readonly #wait: MovementWait;
  #active:
    | { readonly taskId: string; readonly controller: AbortController }
    | undefined;
  #portStopped = false;

  constructor(options: MovementCoordinatorOptions) {
    this.#port = options.port;
    this.#stateStore = options.stateStore;
    this.#safetyPolicy = options.safetyPolicy;
    this.#taskQueue = options.taskQueue;
    this.#wait = options.wait ?? defaultWait;
  }

  async execute(command: MovementCommand): Promise<MovementResult> {
    if (this.#active !== undefined) {
      throw new MovementError("MOVEMENT_ALREADY_ACTIVE");
    }
    const controller = new AbortController();
    this.#active = { taskId: command.taskId, controller };
    this.#portStopped = false;
    let completed = 0;
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
        claimed.taskType !== command.taskType
      ) {
        return Object.freeze({
          outcome: "failed",
          reason: "task_not_claimed",
          stepsCompleted: 0,
        });
      }
      const snapshot = this.#stateStore.getSnapshot();
      if (snapshot.task.state !== "idle") {
        return Object.freeze({
          outcome: "failed",
          reason: "task_state_conflict",
          stepsCompleted: 0,
        });
      }
      const initialSafety = this.#safetyPolicy.evaluate(snapshot, "start");
      if (initialSafety.disposition !== "allow") {
        await finalize("stopped");
        return Object.freeze({
          outcome: "stopped",
          reason: "safety_stop",
          stepsCompleted: 0,
        });
      }
      const position = snapshot.minecraft.position;
      const dimension = snapshot.minecraft.dimension;
      if (position === undefined || dimension === undefined) {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "invalid_position",
          stepsCompleted: 0,
        });
      }
      const origin = { ...position, dimension } satisfies MovementPosition;
      let plan;
      try {
        plan = createMovementPlan(origin, command.target, command.limits);
      } catch (error) {
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason:
            error instanceof MovementError &&
            error.code === "INVALID_MOVEMENT_POSITION"
              ? "invalid_position"
              : "invalid_plan",
          stepsCompleted: 0,
        });
      }

      this.#stateStore.dispatch({
        type: "task.prepare",
        taskId: command.taskId,
        taskType: command.taskType,
      });
      this.#stateStore.dispatch({ type: "task.transition", to: "running" });

      for (const step of plan.steps) {
        const before = this.#safetyPolicy.evaluate(
          this.#stateStore.getSnapshot(),
          "continue",
        );
        if (before.disposition !== "allow") {
          this.#stopPortOnce();
          await finalize("stopped");
          return Object.freeze({
            outcome: "stopped",
            reason: "safety_stop",
            stepsCompleted: completed,
          });
        }
        const outcome = await this.#executeStep(
          step,
          command.limits.stepTimeoutMs,
          controller.signal,
        );
        if (outcome.kind !== "position") {
          this.#stopPortOnce();
          const stopped = outcome.kind === "cancelled";
          await finalize(stopped ? "stopped" : "failed");
          return Object.freeze({
            outcome: stopped ? "stopped" : "failed",
            reason:
              outcome.kind === "cancelled"
                ? "cancelled"
                : outcome.kind === "timeout"
                  ? "step_timeout"
                  : "movement_port_error",
            stepsCompleted: completed,
          } as MovementResult);
        }
        if (controller.signal.aborted) {
          this.#stopPortOnce();
          await finalize("stopped");
          return Object.freeze({
            outcome: "stopped",
            reason: "cancelled",
            stepsCompleted: completed,
          });
        }
        try {
          validateMovementPosition(outcome.position);
        } catch {
          this.#stopPortOnce();
          await finalize("failed");
          return Object.freeze({
            outcome: "failed",
            reason: "invalid_position",
            stepsCompleted: completed,
          });
        }
        if (
          !isWithinArrivalTolerance(
            outcome.position,
            step.target,
            command.limits.arrivalTolerance,
          )
        ) {
          this.#stopPortOnce();
          await finalize("failed");
          return Object.freeze({
            outcome: "failed",
            reason: "target_not_reached",
            stepsCompleted: completed,
          });
        }
        this.#stateStore.dispatch({
          type: "minecraft.telemetry.update",
          telemetry: {
            position: outcome.position,
            dimension: outcome.position.dimension,
          },
        });
        completed += 1;
        this.#stateStore.dispatch({
          type: "task.progress.update",
          progress: plan.steps.length === 0 ? 1 : completed / plan.steps.length,
        });
        const after = this.#safetyPolicy.evaluate(
          this.#stateStore.getSnapshot(),
          "continue",
        );
        if (after.disposition !== "allow") {
          this.#stopPortOnce();
          await finalize("stopped");
          return Object.freeze({
            outcome: "stopped",
            reason: "safety_stop",
            stepsCompleted: completed,
          });
        }
      }
      const finalPosition =
        plan.steps.length === 0 ? origin : plan.steps.at(-1)?.target;
      const finalSnapshot = this.#stateStore.getSnapshot();
      const observedPosition = finalSnapshot.minecraft.position;
      const observedDimension = finalSnapshot.minecraft.dimension;
      if (
        finalPosition === undefined ||
        observedPosition === undefined ||
        observedDimension === undefined ||
        !isWithinArrivalTolerance(
          { ...observedPosition, dimension: observedDimension },
          command.target,
          command.limits.arrivalTolerance,
        )
      ) {
        this.#stopPortOnce();
        await finalize("failed");
        return Object.freeze({
          outcome: "failed",
          reason: "target_not_reached",
          stepsCompleted: completed,
        });
      }
      if (controller.signal.aborted) {
        this.#stopPortOnce();
        await finalize("stopped");
        return Object.freeze({
          outcome: "stopped",
          reason: "cancelled",
          stepsCompleted: completed,
        });
      }
      await finalize("completed");
      return Object.freeze({
        outcome: "completed",
        stepsCompleted: completed,
        finalPosition: Object.freeze({
          ...observedPosition,
          dimension: observedDimension,
        }),
      });
    } catch {
      this.#stopPortOnce();
      if (finalizationAttempted) {
        return Object.freeze({
          outcome: "failed",
          reason: "finalization_error",
          stepsCompleted: completed,
        });
      }
      try {
        await finalize("failed");
      } catch {
        return Object.freeze({
          outcome: "failed",
          reason: "finalization_error",
          stepsCompleted: completed,
        });
      }
      return Object.freeze({
        outcome: "failed",
        reason: "movement_port_error",
        stepsCompleted: completed,
      });
    } finally {
      if (this.#active?.taskId === command.taskId) this.#active = undefined;
    }
  }

  cancel(): void {
    const active = this.#active;
    if (active === undefined || active.controller.signal.aborted) return;
    active.controller.abort();
    this.#stopPortOnce();
  }

  async #executeStep(
    step: Parameters<MovementPort["move"]>[0],
    timeoutMs: number,
    parentSignal: AbortSignal,
  ): Promise<StepOutcome> {
    if (parentSignal.aborted) return { kind: "cancelled" };
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    parentSignal.addEventListener("abort", abort, { once: true });
    try {
      const movement: Promise<StepOutcome> = Promise.resolve()
        .then(() => {
          if (parentSignal.aborted || controller.signal.aborted) {
            throw new Error("movement cancelled");
          }
          return this.#port.move(step, controller.signal);
        })
        .then((position) => ({ kind: "position" as const, position }))
        .catch(() => ({
          kind: parentSignal.aborted ? "cancelled" : "error",
        }));
      const timeout = this.#wait(
        timeoutMs,
        controller.signal,
      ).then<StepOutcome>(() => {
        if (parentSignal.aborted) return { kind: "cancelled" };
        controller.abort();
        return { kind: "timeout" };
      });
      return await Promise.race([movement, timeout]);
    } finally {
      parentSignal.removeEventListener("abort", abort);
      controller.abort();
    }
  }

  #stopPortOnce(): void {
    if (this.#portStopped) return;
    this.#portStopped = true;
    try {
      this.#port.stop();
    } catch {
      // A port cleanup failure must not prevent task finalization.
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
