import { taskRecoveryDisposition } from "../../domain/task-queue/index.js";
import type { TaskQueueRepository } from "../../ports/task-queue-repository.js";

export interface TaskRecoveryAudit {
  readonly claimable: number;
  readonly manualReview: number;
  readonly terminal: number;
}

export class TaskRecoveryAuditError extends Error {
  override readonly name = "TaskRecoveryAuditError";
  readonly code = "TASK_RECOVERY_AUDIT_FAILED";

  constructor() {
    super("Task recovery audit failed");
  }
}

export const auditTaskRecovery = async (
  repository: TaskQueueRepository,
): Promise<TaskRecoveryAudit> => {
  let claimable = 0;
  let manualReview = 0;
  let terminal = 0;
  let items: Awaited<ReturnType<TaskQueueRepository["list"]>>;
  try {
    items = await repository.list();
  } catch {
    throw new TaskRecoveryAuditError();
  }
  for (const item of items) {
    switch (taskRecoveryDisposition(item)) {
      case "claimable":
        claimable += 1;
        break;
      case "manual_review":
        manualReview += 1;
        break;
      case "terminal":
        terminal += 1;
        break;
    }
  }
  return Object.freeze({ claimable, manualReview, terminal });
};
