export type TaskQueueErrorCode =
  "INVALID_TASK_INSTRUCTION" | "TASK_NOT_FOUND" | "INVALID_TASK_TRANSITION";

export class TaskQueueError extends Error {
  override readonly name = "TaskQueueError";

  constructor(readonly code: TaskQueueErrorCode) {
    super(code);
  }
}
