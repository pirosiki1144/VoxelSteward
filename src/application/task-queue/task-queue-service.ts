import {
  cancelTask,
  createQueuedTask,
  finishTask,
  markTaskDeliveryStarted,
  markTaskVerified,
  releaseTask,
  TaskQueueError,
  type TaskQueueClock,
  type TaskQueueCommand,
  type TaskQueueEvent,
  type TaskQueueItem,
} from "../../domain/task-queue/index.js";
import type { TaskQueueRepository } from "../../ports/task-queue-repository.js";

export class TaskQueueService {
  readonly #repository: TaskQueueRepository;
  readonly #clock: TaskQueueClock;

  constructor(
    repository: TaskQueueRepository,
    clock: TaskQueueClock = () => new Date(),
  ) {
    this.#repository = repository;
    this.#clock = clock;
  }

  find(taskId: string): Promise<TaskQueueItem | undefined> {
    return this.#repository.find(taskId);
  }

  async dispatch(command: TaskQueueCommand): Promise<TaskQueueEvent> {
    const occurredAt = this.#clock().toISOString();
    let item: TaskQueueItem | undefined;
    switch (command.type) {
      case "task.enqueue":
        item = await this.#repository.insert(
          createQueuedTask(command.instruction, () => new Date(occurredAt)),
        );
        break;
      case "task.claim_next":
        if (
          (command.claimOwner === undefined) !==
            (command.leaseDurationMs === undefined) ||
          (command.leaseDurationMs !== undefined &&
            (!Number.isSafeInteger(command.leaseDurationMs) ||
              command.leaseDurationMs < 1 ||
              command.leaseDurationMs > 300_000))
        ) {
          throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
        }
        item = await this.#repository.claimNext(
          occurredAt,
          command.allowedTaskTypes,
          command.claimOwner,
          command.leaseDurationMs === undefined
            ? undefined
            : new Date(
                new Date(occurredAt).getTime() + command.leaseDurationMs,
              ).toISOString(),
        );
        break;
      case "task.cancel": {
        const current = await this.#required(command.taskId);
        item = cancelTask(current, () => new Date(occurredAt));
        await this.#repository.replace(current, item);
        break;
      }
      case "task.release": {
        const current = await this.#required(command.taskId);
        item = releaseTask(current, () => new Date(occurredAt));
        await this.#repository.replace(current, item);
        break;
      }
      case "task.mark_delivery_started": {
        const current = await this.#required(command.taskId);
        item = markTaskDeliveryStarted(current, () => new Date(occurredAt));
        await this.#repository.replace(current, item);
        break;
      }
      case "task.mark_verified": {
        const current = await this.#required(command.taskId);
        item = markTaskVerified(current, () => new Date(occurredAt));
        await this.#repository.replace(current, item);
        break;
      }
      case "task.finish": {
        const current = await this.#required(command.taskId);
        item = finishTask(current, command.outcome, () => new Date(occurredAt));
        await this.#repository.replace(current, item);
        break;
      }
    }
    return Object.freeze({ command: command.type, occurredAt, item });
  }

  async #required(taskId: string): Promise<TaskQueueItem> {
    const item = await this.#repository.find(taskId);
    if (item === undefined) throw new TaskQueueError("TASK_NOT_FOUND");
    return item;
  }
}
