import type { MovementCoordinator } from "../movement/index.js";
import {
  isWithinArrivalTolerance,
  validateMovementPosition,
  type MovementPosition,
} from "../../domain/movement/index.js";
import {
  validateSimpleWorkInstruction,
  type SimpleWorkInstruction,
  type SimpleWorkProgressListener,
  type SimpleWorkResult,
} from "../../domain/simple-work/index.js";

export interface SimpleWorkCoordinatorOptions {
  readonly movement: Pick<MovementCoordinator, "execute">;
  readonly readPosition: () => MovementPosition | undefined;
}

export class SimpleWorkCoordinator {
  readonly #movement: Pick<MovementCoordinator, "execute">;
  readonly #readPosition: () => MovementPosition | undefined;

  constructor(options: SimpleWorkCoordinatorOptions) {
    this.#movement = options.movement;
    this.#readPosition = options.readPosition;
  }

  async execute(
    instruction: SimpleWorkInstruction,
    onProgress?: SimpleWorkProgressListener,
  ): Promise<SimpleWorkResult> {
    const report = (
      progress: Parameters<SimpleWorkProgressListener>[0],
    ): void => {
      try {
        onProgress?.(Object.freeze(progress));
      } catch {
        // Progress reporting must not alter work safety or finalization.
      }
    };
    try {
      validateSimpleWorkInstruction(instruction);
    } catch {
      report({ phase: "failed", progress: 0 });
      return Object.freeze({
        outcome: "failed",
        taskType: instruction.taskType,
        reason: "invalid_instruction",
      });
    }

    report({ phase: "validated", progress: 0 });
    if (instruction.taskType === "navigate_to") {
      const origin = this.#readPosition();
      if (origin === undefined) {
        report({ phase: "failed", progress: 0 });
        return Object.freeze({
          outcome: "failed",
          taskType: "navigate_to",
          reason: "position_unavailable",
        });
      }
      try {
        validateMovementPosition(origin);
      } catch {
        report({ phase: "failed", progress: 0 });
        return Object.freeze({
          outcome: "failed",
          taskType: "navigate_to",
          reason: "invalid_observed_position",
        });
      }
      if (
        origin.dimension !== instruction.target.dimension ||
        Math.abs(origin.y - instruction.target.y) > Number.EPSILON
      ) {
        report({ phase: "failed", progress: 0 });
        return Object.freeze({
          outcome: "failed",
          taskType: "navigate_to",
          reason: "unsupported_navigation",
        });
      }
      report({ phase: "executing", progress: 0 });
      let result;
      try {
        result = await this.#movement.execute({
          taskId: instruction.taskId,
          taskType: instruction.taskType,
          target: instruction.target,
          limits: instruction.limits,
        });
      } catch {
        report({ phase: "failed", progress: 0, stepsCompleted: 0 });
        return Object.freeze({
          outcome: "failed",
          taskType: "navigate_to",
          reason: "movement_port_error",
          stepsCompleted: 0,
        });
      }
      if (result.outcome === "completed") {
        report({ phase: "completed", progress: 1 });
        return Object.freeze({
          outcome: "completed",
          taskType: "navigate_to",
          position: Object.freeze({ ...result.finalPosition }),
          stepsCompleted: result.stepsCompleted,
        });
      }
      report({
        phase: result.outcome,
        progress: 0,
        stepsCompleted: result.stepsCompleted,
      });
      if (result.outcome === "stopped") {
        return Object.freeze({
          outcome: "stopped",
          taskType: "navigate_to",
          reason: result.reason,
          stepsCompleted: result.stepsCompleted,
        });
      }
      return Object.freeze({
        outcome: "failed",
        taskType: "navigate_to",
        reason: result.reason,
        stepsCompleted: result.stepsCompleted,
      });
    }

    const position = this.#readPosition();
    if (position === undefined) {
      report({ phase: "failed", progress: 0 });
      return Object.freeze({
        outcome: "failed",
        taskType: instruction.taskType,
        reason: "position_unavailable",
      });
    }
    try {
      validateMovementPosition(position);
    } catch {
      report({ phase: "failed", progress: 0 });
      return Object.freeze({
        outcome: "failed",
        taskType: instruction.taskType,
        reason: "invalid_observed_position",
      });
    }
    const frozenPosition = Object.freeze({ ...position });
    report({ phase: "completed", progress: 1 });
    if (instruction.taskType === "verify_arrival") {
      return Object.freeze({
        outcome: "completed",
        taskType: "verify_arrival",
        position: frozenPosition,
        arrived: isWithinArrivalTolerance(
          frozenPosition,
          instruction.expected,
          instruction.tolerance,
        ),
      });
    }
    return Object.freeze({
      outcome: "completed",
      taskType: "record_position",
      position: frozenPosition,
    });
  }
}
