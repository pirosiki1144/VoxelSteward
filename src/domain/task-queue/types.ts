export type TaskQueueStatus =
  "queued" | "claimed" | "completed" | "failed" | "stopped" | "cancelled";

export interface TaskInstruction {
  readonly taskId: string;
  readonly taskType: string;
  readonly priority: number;
  readonly maxAttempts: number;
}

export interface TaskQueueItem extends TaskInstruction {
  readonly status: TaskQueueStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly claimedAt?: string | undefined;
  readonly finishedAt?: string | undefined;
}

export type TaskQueueTerminalStatus = Extract<
  TaskQueueStatus,
  "completed" | "failed" | "stopped"
>;

export type TaskQueueCommand =
  | { readonly type: "task.enqueue"; readonly instruction: TaskInstruction }
  | { readonly type: "task.claim_next" }
  | { readonly type: "task.cancel"; readonly taskId: string }
  | { readonly type: "task.release"; readonly taskId: string }
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
