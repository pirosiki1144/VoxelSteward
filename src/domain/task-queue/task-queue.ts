import {
  blockOperationInstructionEquals,
  validateBlockOperationInstruction,
} from "../block-operation/index.js";
import { validateSimpleWorkInstruction } from "../simple-work/index.js";
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

const freezeInstruction = (instruction: TaskInstruction): TaskInstruction => {
  if (instruction.details === undefined)
    return Object.freeze({ ...instruction });
  const details = instruction.details;
  if (details.kind === "verify_arrival") {
    const simple = details.instruction;
    return Object.freeze({
      ...instruction,
      details: Object.freeze({
        ...details,
        instruction: Object.freeze({
          ...simple,
          expected: Object.freeze({ ...simple.expected }),
        }),
      }),
    });
  }
  if (details.kind === "record_position") {
    return Object.freeze({
      ...instruction,
      details: Object.freeze({
        ...details,
        instruction: Object.freeze({ ...details.instruction }),
      }),
    });
  }
  const operation = details.instruction;
  return Object.freeze({
    ...instruction,
    details: Object.freeze({
      ...details,
      instruction: Object.freeze({
        ...operation,
        target: Object.freeze({ ...operation.target }),
        support: Object.freeze({
          ...operation.support,
          position: Object.freeze({ ...operation.support.position }),
        }),
      }),
    }),
  });
};

const freezeItem = (item: TaskQueueItem): TaskQueueItem => {
  const instruction = freezeInstruction(item);
  return Object.freeze({
    taskId: instruction.taskId,
    taskType: instruction.taskType,
    priority: instruction.priority,
    maxAttempts: instruction.maxAttempts,
    ...(instruction.details === undefined
      ? {}
      : { details: instruction.details }),
    status: item.status,
    attempts: item.attempts,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    executionPhase: item.executionPhase,
    ...(item.claimedAt === undefined ? {} : { claimedAt: item.claimedAt }),
    ...(item.finishedAt === undefined ? {} : { finishedAt: item.finishedAt }),
  });
};

export const validateTaskInstruction = (instruction: TaskInstruction): void => {
  const keys = Object.keys(instruction);
  if (
    !keys.every((key) =>
      ["taskId", "taskType", "priority", "maxAttempts", "details"].includes(
        key,
      ),
    ) ||
    keys.length !== (instruction.details === undefined ? 4 : 5) ||
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
  if (instruction.details !== undefined) {
    const details = instruction.details;
    const detailKeys = Object.keys(details);
    if (
      details.version !== 1 ||
      detailKeys.length !== 3 ||
      !detailKeys.every((key) =>
        ["version", "kind", "instruction"].includes(key),
      ) ||
      instruction.taskId !== details.instruction.taskId ||
      instruction.taskType !== details.kind
    ) {
      throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
    }
    try {
      if (details.kind === "place_single_dirt") {
        validateBlockOperationInstruction(details.instruction);
        if (instruction.maxAttempts !== 1)
          throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
      } else {
        validateSimpleWorkInstruction(details.instruction);
        if (
          details.kind !== "verify_arrival" &&
          details.kind !== "record_position"
        ) {
          throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
        }
      }
    } catch {
      throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
    }
  } else if (
    instruction.taskType === "place_single_dirt" ||
    instruction.taskType === "verify_arrival" ||
    instruction.taskType === "record_position"
  ) {
    throw new TaskQueueError("INVALID_TASK_INSTRUCTION");
  }
};

export const taskInstructionEquals = (
  left: TaskInstruction,
  right: TaskInstruction,
): boolean => {
  if (left.details === undefined && right.details === undefined)
    return left.taskId === right.taskId;
  if (
    left.details === undefined ||
    right.details === undefined ||
    left.details.kind !== right.details.kind
  )
    return false;
  let detailsEqual = false;
  if (
    left.details.kind === "place_single_dirt" &&
    right.details.kind === "place_single_dirt"
  ) {
    detailsEqual = blockOperationInstructionEquals(
      left.details.instruction,
      right.details.instruction,
    );
  } else if (
    left.details.kind === "verify_arrival" &&
    right.details.kind === "verify_arrival"
  ) {
    const leftInstruction = left.details.instruction;
    const rightInstruction = right.details.instruction;
    detailsEqual =
      leftInstruction.taskId === rightInstruction.taskId &&
      leftInstruction.taskType === rightInstruction.taskType &&
      leftInstruction.tolerance === rightInstruction.tolerance &&
      leftInstruction.expected.x === rightInstruction.expected.x &&
      leftInstruction.expected.y === rightInstruction.expected.y &&
      leftInstruction.expected.z === rightInstruction.expected.z &&
      leftInstruction.expected.dimension ===
        rightInstruction.expected.dimension;
  } else if (
    left.details.kind === "record_position" &&
    right.details.kind === "record_position"
  ) {
    detailsEqual =
      left.details.instruction.taskId === right.details.instruction.taskId &&
      left.details.instruction.taskType === right.details.instruction.taskType;
  }
  return (
    left.taskId === right.taskId &&
    left.taskType === right.taskType &&
    left.priority === right.priority &&
    left.maxAttempts === right.maxAttempts &&
    detailsEqual
  );
};

export const createQueuedTask = (
  instruction: TaskInstruction,
  clock: TaskQueueClock,
): TaskQueueItem => {
  validateTaskInstruction(instruction);
  const now = clock().toISOString();
  return freezeItem({
    ...freezeInstruction(instruction),
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    executionPhase: "not_started",
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
  return freezeItem({ ...item, ...fields, status, updatedAt: now });
};

export const markTaskDeliveryStarted = (
  item: TaskQueueItem,
  clock: TaskQueueClock,
): TaskQueueItem => {
  if (
    item.status !== "claimed" ||
    item.executionPhase !== "not_started" ||
    item.details?.kind !== "place_single_dirt" ||
    item.maxAttempts !== 1
  ) {
    throw new TaskQueueError("INVALID_TASK_TRANSITION");
  }
  return freezeItem({
    ...item,
    executionPhase: "delivery_started",
    updatedAt: clock().toISOString(),
  });
};

export const markTaskVerified = (
  item: TaskQueueItem,
  clock: TaskQueueClock,
): TaskQueueItem => {
  if (item.status !== "claimed" || item.executionPhase !== "delivery_started") {
    throw new TaskQueueError("INVALID_TASK_TRANSITION");
  }
  return freezeItem({
    ...item,
    executionPhase: "verified",
    updatedAt: clock().toISOString(),
  });
};

export const taskRecoveryDisposition = (
  item: TaskQueueItem,
): "claimable" | "manual_review" | "terminal" =>
  item.status === "queued"
    ? "claimable"
    : item.status === "claimed"
      ? "manual_review"
      : "terminal";

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
