import type { PlaceSingleBlockInstruction } from "../block-operation/index.js";
import type {
  RecordPositionInstruction,
  VerifyArrivalInstruction,
} from "../simple-work/index.js";

export type TaskQueueStatus =
  "queued" | "claimed" | "completed" | "failed" | "stopped" | "cancelled";

export interface TaskInstruction {
  readonly taskId: string;
  readonly taskType: string;
  readonly priority: number;
  readonly maxAttempts: number;
  readonly details?:
    | {
        readonly version: 1;
        readonly kind: "place_single_dirt";
        readonly instruction: PlaceSingleBlockInstruction;
      }
    | {
        readonly version: 1;
        readonly kind: "verify_arrival";
        readonly instruction: VerifyArrivalInstruction;
      }
    | {
        readonly version: 1;
        readonly kind: "record_position";
        readonly instruction: RecordPositionInstruction;
      }
    | undefined;
}

export type TaskExecutionPhase =
  "not_started" | "delivery_started" | "verified";

export interface TaskQueueItem extends TaskInstruction {
  readonly status: TaskQueueStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly claimedAt?: string | undefined;
  readonly finishedAt?: string | undefined;
  readonly executionPhase: TaskExecutionPhase;
}

export type TaskQueueTerminalStatus = Extract<
  TaskQueueStatus,
  "completed" | "failed" | "stopped"
>;

export type TaskQueueCommand =
  | { readonly type: "task.enqueue"; readonly instruction: TaskInstruction }
  | {
      readonly type: "task.claim_next";
      readonly allowedTaskTypes?: readonly string[];
      readonly claimOwner?: string;
      readonly leaseDurationMs?: number;
    }
  | { readonly type: "task.cancel"; readonly taskId: string }
  | { readonly type: "task.release"; readonly taskId: string }
  | { readonly type: "task.mark_delivery_started"; readonly taskId: string }
  | { readonly type: "task.mark_verified"; readonly taskId: string }
  | {
      readonly type: "task.finish";
      readonly taskId: string;
      readonly outcome: TaskQueueTerminalStatus;
    };

export interface TaskQueueEvent {
  readonly command: TaskQueueCommand["type"];
  readonly occurredAt: string;
  readonly item?: TaskQueueItem | undefined;
}

export type TaskQueueClock = () => Date;
