import type {
  MovementLimits,
  MovementPosition,
  MovementResult,
} from "../movement/index.js";

export type SimpleWorkType =
  "navigate_to" | "verify_arrival" | "record_position";

interface SimpleWorkInstructionBase {
  readonly taskId: string;
  readonly taskType: SimpleWorkType;
}

export interface NavigateToInstruction extends SimpleWorkInstructionBase {
  readonly taskType: "navigate_to";
  readonly target: MovementPosition;
  readonly limits: MovementLimits;
}

export interface VerifyArrivalInstruction extends SimpleWorkInstructionBase {
  readonly taskType: "verify_arrival";
  readonly expected: MovementPosition;
  readonly tolerance: number;
}

export interface RecordPositionInstruction extends SimpleWorkInstructionBase {
  readonly taskType: "record_position";
}

export type SimpleWorkInstruction =
  NavigateToInstruction | VerifyArrivalInstruction | RecordPositionInstruction;

export type SimpleWorkProgress =
  | { readonly phase: "validated"; readonly progress: 0 }
  | { readonly phase: "executing"; readonly progress: 0 }
  | { readonly phase: "completed"; readonly progress: 1 }
  | {
      readonly phase: "stopped";
      readonly progress: 0;
      readonly stepsCompleted?: number;
    }
  | {
      readonly phase: "failed";
      readonly progress: 0;
      readonly stepsCompleted?: number;
    };

export type SimpleWorkResult =
  | {
      readonly outcome: "completed";
      readonly taskType: "navigate_to";
      readonly position: MovementPosition;
      readonly stepsCompleted: number;
    }
  | {
      readonly outcome: "completed";
      readonly taskType: "verify_arrival";
      readonly position: MovementPosition;
      readonly arrived: boolean;
    }
  | {
      readonly outcome: "completed";
      readonly taskType: "record_position";
      readonly position: MovementPosition;
    }
  | {
      readonly outcome: "stopped";
      readonly taskType: "navigate_to";
      readonly reason: Extract<
        MovementResult,
        { outcome: "stopped" }
      >["reason"];
      readonly stepsCompleted: number;
    }
  | {
      readonly outcome: "failed";
      readonly taskType: SimpleWorkType;
      readonly reason:
        | "invalid_instruction"
        | "position_unavailable"
        | "invalid_observed_position"
        | "unsupported_navigation"
        | Extract<MovementResult, { outcome: "failed" }>["reason"];
      readonly stepsCompleted?: number;
    };

export type SimpleWorkProgressListener = (progress: SimpleWorkProgress) => void;
