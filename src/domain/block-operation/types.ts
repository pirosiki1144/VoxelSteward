import type { MinecraftDimension } from "../movement/index.js";

export const ALLOWED_PLACE_BLOCKS = ["dirt"] as const;
export type AllowedPlaceBlock = (typeof ALLOWED_PLACE_BLOCKS)[number];

export type ObservedBlockType = AllowedPlaceBlock | "air" | "solid_other";

export interface BlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dimension: MinecraftDimension;
}

export interface BlockObservation {
  readonly position: BlockPosition;
  readonly blockType: ObservedBlockType;
}

export interface PlaceSingleBlockInstruction {
  readonly taskId: string;
  readonly taskType: "place_single_dirt";
  readonly operation: "place";
  readonly target: BlockPosition;
  readonly blockType: "dirt";
  readonly expectedBefore: "air";
  readonly expectedAfter: "dirt";
  readonly support: {
    readonly position: BlockPosition;
    readonly expected: "solid";
    readonly face: "up";
  };
  readonly maxReach: number;
  readonly timeoutMs: number;
}

export type BlockOperationInstruction = PlaceSingleBlockInstruction;

export type BlockOperationFailureReason =
  | "invalid_instruction"
  | "task_not_claimed"
  | "task_state_conflict"
  | "invalid_position"
  | "out_of_reach"
  | "unexpected_before"
  | "unsupported_support"
  | "unexpected_after"
  | "unsupported_adapter"
  | "timeout"
  | "disconnected"
  | "port_error"
  | "finalization_error";

export type BlockOperationResult =
  | {
      readonly outcome: "completed";
      readonly observation: BlockObservation;
    }
  | {
      readonly outcome: "stopped";
      readonly reason: "safety_stop" | "cancelled";
    }
  | {
      readonly outcome: "failed";
      readonly reason: BlockOperationFailureReason;
    };

export type BlockOperationProgress =
  | { readonly phase: "validated"; readonly progress: 0 }
  | { readonly phase: "observing"; readonly progress: 0 }
  | { readonly phase: "placing"; readonly progress: 0.5 }
  | { readonly phase: "completed"; readonly progress: 1 }
  | { readonly phase: "stopped" | "failed"; readonly progress: 0 };

export type BlockOperationProgressListener = (
  progress: BlockOperationProgress,
) => void;
