import type { TaskQueueItem } from "../domain/task-queue/index.js";

export interface TaskQueueRepository {
  insert(item: TaskQueueItem): Promise<TaskQueueItem>;
  find(taskId: string): Promise<TaskQueueItem | undefined>;
  claimNext(claimedAt: string): Promise<TaskQueueItem | undefined>;
  replace(expected: TaskQueueItem, item: TaskQueueItem): Promise<void>;
  list(): Promise<readonly TaskQueueItem[]>;
  close(): Promise<void>;
}
