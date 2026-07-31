export type MinecraftDimension = "overworld" | "nether" | "end";

export interface MovementPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dimension: MinecraftDimension;
}

export interface MovementLimits {
  readonly maxStepDistance: number;
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  readonly arrivalTolerance: number;
}

export interface MovementCommand {
  readonly taskId: string;
  readonly taskType: string;
  readonly target: MovementPosition;
  readonly limits: MovementLimits;
}

export interface MovementStep {
  readonly index: number;
  readonly total: number;
  readonly target: MovementPosition;
}

export interface MovementPlan {
  readonly origin: MovementPosition;
  readonly target: MovementPosition;
  readonly steps: readonly MovementStep[];
  readonly limits: MovementLimits;
}

export type MovementResult =
  | {
      readonly outcome: "completed";
      readonly stepsCompleted: number;
      readonly finalPosition: MovementPosition;
    }
  | {
      readonly outcome: "stopped";
      readonly reason: "cancelled" | "safety_stop";
      readonly stepsCompleted: number;
    }
  | {
      readonly outcome: "failed";
      readonly reason:
        | "invalid_position"
        | "invalid_plan"
        | "task_not_claimed"
        | "task_state_conflict"
        | "step_timeout"
        | "movement_port_error"
        | "target_not_reached"
        | "finalization_error";
      readonly stepsCompleted: number;
    };
