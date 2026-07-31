import { TaskQueueError } from "./errors.js";
import type {
  TaskInstruction,
  TaskQueueClock,
  TaskQueueItem,
  TaskQueueStatus,
  TaskQueueTerminalStatus,
} from "./types.js";

const identifier = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const allowedTransitions: Readonly<
  Record<TaskQueueStatus, readonly TaskQueueStatus[]>
> = {
  queued: ["claimed", "cancelled"],
  claimed: ["queued", "completed", "failed", "stopped"],
  completed: [],
  failed: [],
  stopped: [],
  cancelled: [],
};

const freeze = <T extends object>(value: T): Readonly<T> =>
  Object.freeze(value);

export const validateTaskInstruction = (instruction: TaskInstruction): void => {
  if (
    !identifier.test(instruction.taskId) ||
    !identifier.test(instruction.taskType) ||
    !Number.isSafeInteger(instruction.priority) ||
    instruction.priority < 0 ||
    instruction.priority > 100 ||
    !Number.isSafeInteger(instruction.maxAttempts) ||
    instruction.maxAttempts < 1 ||
    instruction.maxAttempts > 10
  ) {
    throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
  }
};

export const createQueuedTask = (
  instruction: TaskInstruction,
  clock: TaskQueueClock,
): TaskQueueItem => {
  validateTaskInstruction(instruction);
  const now = clock().toISOString();
  return freeze({
    ...instruction,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  });
};

const transition = (
  item: TaskQueueItem,
  status: TaskQueueStatus,
  clock: TaskQueueClock,
  fields: Partial<TaskQueueItem> = {},
): TaskQueueItem => {
  if (!allowedTransitions[item.status].includes(status)) {
    throw new TaskQueueError("INVALID_TASK_TRANSITION");
  }
  const now = clock().toISOString();
  return freeze({ ...item, ...fields, status, updatedAt: now });
};

export const claimTask = (
  item: TaskQueueItem,
  clock: TaskQueueClock,
): TaskQueueItem => {
  const claimedAt = clock().toISOString();
  return transition(item, "claimed", () => new Date(claimedAt), {
    attempts: item.attempts + 1,
    claimedAt,
    finishedAt: undefined,
  });
};

export const cancelTask = (
  item: TaskQueueItem,
  clock: TaskQueueClock,
): TaskQueueItem => {
  const finishedAt = clock().toISOString();
  return transition(item, "cancelled", () => new Date(finishedAt), {
    finishedAt,
  });
};

export const releaseTask = (
  item: TaskQueueItem,
  clock: TaskQueueClock,
): TaskQueueItem => {
  if (item.status !== "claimed")
    throw new TaskQueueError("INVALID_TASK_TRANSITION");
  const next = item.attempts >= item.maxAttempts ? "failed" : "queued";
  const now = clock().toISOString();
  return transition(item, next, () => new Date(now), {
    claimedAt: next === "queued" ? undefined : item.claimedAt,
    finishedAt: next === "failed" ? now : undefined,
  });
};

export const finishTask = (
  item: TaskQueueItem,
  outcome: TaskQueueTerminalStatus,
  clock: TaskQueueClock,
): TaskQueueItem => {
  const finishedAt = clock().toISOString();
  return transition(item, outcome, () => new Date(finishedAt), { finishedAt });
};
