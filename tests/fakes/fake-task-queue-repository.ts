import {
  claimTask,
  type TaskQueueItem,
} from "../../src/domain/task-queue/index.js";
import { blockOperationInstructionEquals } from "../../src/domain/block-operation/index.js";
import type { TaskQueueRepository } from "../../src/ports/task-queue-repository.js";

export class FakeTaskQueueRepository implements TaskQueueRepository {
  readonly #items = new Map<string, TaskQueueItem>();
  #closed = false;
  replaceError: Error | undefined;

  insert(item: TaskQueueItem): Promise<TaskQueueItem> {
    this.#ensureOpen();
    const existing = this.#items.get(item.taskId);
    if (existing !== undefined) {
      if (
        (existing.details !== undefined || item.details !== undefined) &&
        (existing.taskType !== item.taskType ||
          existing.priority !== item.priority ||
          existing.maxAttempts !== item.maxAttempts ||
          existing.details?.version !== item.details?.version ||
          existing.details?.kind !== item.details?.kind ||
          existing.details === undefined ||
          item.details === undefined ||
          !blockOperationInstructionEquals(
            existing.details.instruction,
            item.details.instruction,
          ))
      ) {
        return Promise.reject(new Error("task instruction conflict"));
      }
      return Promise.resolve(existing);
    }
    this.#items.set(item.taskId, item);
    return Promise.resolve(item);
  }

  find(taskId: string): Promise<TaskQueueItem | undefined> {
    this.#ensureOpen();
    return Promise.resolve(this.#items.get(taskId));
  }

  claimNext(claimedAt: string): Promise<TaskQueueItem | undefined> {
    this.#ensureOpen();
    const item = [...this.#items.values()]
      .filter(({ status }) => status === "queued")
      .sort(
        (left, right) =>
          right.priority - left.priority ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.taskId.localeCompare(right.taskId),
      )[0];
    if (item === undefined) return Promise.resolve(undefined);
    const claimed = claimTask(item, () => new Date(claimedAt));
    this.#items.set(item.taskId, claimed);
    return Promise.resolve(claimed);
  }

  replace(expected: TaskQueueItem, item: TaskQueueItem): Promise<void> {
    this.#ensureOpen();
    if (this.replaceError !== undefined)
      return Promise.reject(this.replaceError);
    const current = this.#items.get(item.taskId);
    if (
      current?.status !== expected.status ||
      current.executionPhase !== expected.executionPhase ||
      current.updatedAt !== expected.updatedAt
    )
      return Promise.reject(new Error("queue conflict"));
    this.#items.set(item.taskId, item);
    return Promise.resolve();
  }

  list(): Promise<readonly TaskQueueItem[]> {
    this.#ensureOpen();
    return Promise.resolve([...this.#items.values()]);
  }

  close(): Promise<void> {
    this.#closed = true;
    return Promise.resolve();
  }

  #ensureOpen(): void {
    if (this.#closed) throw new Error("repository closed");
  }
}
