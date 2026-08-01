import { validateMovementPosition } from "../movement/index.js";
import { BlockOperationError } from "./errors.js";
import type {
  BlockObservation,
  BlockOperationInstruction,
  BlockPosition,
} from "./types.js";

export const MAX_BLOCK_REACH = 3;
export const MAX_BLOCK_OPERATION_TIMEOUT_MS = 30_000;
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const invalid = (): never => {
  throw new BlockOperationError("INVALID_BLOCK_OPERATION_INSTRUCTION");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const exactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
};

export function validateBlockPosition(
  value: unknown,
): asserts value is BlockPosition {
  if (!isRecord(value)) invalid();
  const position = value as Record<string, unknown>;
  if (!exactKeys(position, ["x", "y", "z", "dimension"])) invalid();
  try {
    validateMovementPosition(position as unknown as BlockPosition);
  } catch {
    invalid();
  }
  if (![position.x, position.y, position.z].every(Number.isInteger)) invalid();
}

export function validateBlockOperationInstruction(
  value: unknown,
): asserts value is BlockOperationInstruction {
  if (!isRecord(value)) invalid();
  const instruction = value as Record<string, unknown>;
  if (
    !exactKeys(instruction, [
      "taskId",
      "schemaVersion",
      "taskType",
      "operation",
      "target",
      "blockType",
      "expectedBefore",
      "expectedAfter",
      "support",
      "maxReach",
      "timeoutMs",
    ]) ||
    instruction.schemaVersion !== 1 ||
    typeof instruction.taskId !== "string" ||
    !TASK_ID_PATTERN.test(instruction.taskId) ||
    instruction.taskType !== "place_single_dirt" ||
    instruction.operation !== "place" ||
    instruction.blockType !== "dirt" ||
    instruction.expectedBefore !== "air" ||
    instruction.expectedAfter !== "dirt"
  )
    invalid();
  validateBlockPosition(instruction.target);
  if (!isRecord(instruction.support)) invalid();
  const supportDefinition = instruction.support as Record<string, unknown>;
  if (
    !exactKeys(supportDefinition, ["position", "expected", "face"]) ||
    supportDefinition.expected !== "solid" ||
    supportDefinition.face !== "up"
  )
    invalid();
  validateBlockPosition(supportDefinition.position);
  const target = instruction.target;
  const support = supportDefinition.position;
  if (
    target.dimension !== support.dimension ||
    support.x !== target.x ||
    support.y !== target.y - 1 ||
    support.z !== target.z
  )
    invalid();
  if (
    typeof instruction.maxReach !== "number" ||
    !Number.isFinite(instruction.maxReach) ||
    instruction.maxReach <= 0 ||
    instruction.maxReach > MAX_BLOCK_REACH ||
    typeof instruction.timeoutMs !== "number" ||
    !Number.isInteger(instruction.timeoutMs) ||
    instruction.timeoutMs <= 0 ||
    instruction.timeoutMs > MAX_BLOCK_OPERATION_TIMEOUT_MS
  )
    invalid();
}

export function validateBlockObservation(
  value: unknown,
): asserts value is BlockObservation {
  if (!isRecord(value)) invalid();
  const observation = value as Record<string, unknown>;
  if (!exactKeys(observation, ["position", "blockType"])) invalid();
  validateBlockPosition(observation.position);
  if (!["air", "dirt", "solid_other"].includes(observation.blockType as string))
    invalid();
}

export const blockDistance = (a: BlockPosition, b: BlockPosition): number =>
  a.dimension === b.dimension
    ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    : Number.POSITIVE_INFINITY;

export const blockOperationInstructionEquals = (
  left: BlockOperationInstruction,
  right: BlockOperationInstruction,
): boolean =>
  left.schemaVersion === right.schemaVersion &&
  left.taskId === right.taskId &&
  left.taskType === right.taskType &&
  left.operation === right.operation &&
  left.blockType === right.blockType &&
  left.expectedBefore === right.expectedBefore &&
  left.expectedAfter === right.expectedAfter &&
  left.maxReach === right.maxReach &&
  left.timeoutMs === right.timeoutMs &&
  left.support.expected === right.support.expected &&
  left.support.face === right.support.face &&
  left.target.x === right.target.x &&
  left.target.y === right.target.y &&
  left.target.z === right.target.z &&
  left.target.dimension === right.target.dimension &&
  left.support.position.x === right.support.position.x &&
  left.support.position.y === right.support.position.y &&
  left.support.position.z === right.support.position.z &&
  left.support.position.dimension === right.support.position.dimension;
