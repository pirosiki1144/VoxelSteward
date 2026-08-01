import type { TaskQueueItem } from "../domain/task-queue/index.js";

export interface TaskQueueRepository {
  insert(item: TaskQueueItem): Promise<TaskQueueItem>;
  find(taskId: string): Promise<TaskQueueItem | undefined>;
  claimNext(
    claimedAt: string,
    allowedTaskTypes?: readonly string[],
    claimOwner?: string,
    leaseExpiresAt?: string,
  ): Promise<TaskQueueItem | undefined>;
  recoverExpiredClaims(expiredAt: string): Promise<number>;
  replace(expected: TaskQueueItem, item: TaskQueueItem): Promise<void>;
  list(): Promise<readonly TaskQueueItem[]>;
  close(): Promise<void>;
}
