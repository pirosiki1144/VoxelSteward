import {
  validateMovementLimits,
  validateMovementPosition,
  type MovementLimits,
  type MovementPosition,
} from "../movement/index.js";
import { SimpleWorkError } from "./errors.js";
import type { SimpleWorkInstruction } from "./types.js";

const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const invalid = (): never => {
  throw new SimpleWorkError("INVALID_SIMPLE_WORK_INSTRUCTION");
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasOnlyKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(value).every((key) => allowed.includes(key));

function validatePositionShape(
  value: unknown,
): asserts value is MovementPosition {
  if (!isRecord(value) || !hasOnlyKeys(value, ["x", "y", "z", "dimension"])) {
    invalid();
  }
  validateMovementPosition(value as MovementPosition);
}

function validateLimitsShape(value: unknown): asserts value is MovementLimits {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "maxStepDistance",
      "maxSteps",
      "stepTimeoutMs",
      "arrivalTolerance",
    ])
  ) {
    invalid();
  }
  validateMovementLimits(value as MovementLimits);
}

export function validateSimpleWorkInstruction(
  value: unknown,
): asserts value is SimpleWorkInstruction {
  if (!isRecord(value) || typeof value.taskId !== "string") invalid();
  const instruction = value as Record<string, unknown>;
  if (!TASK_ID_PATTERN.test(instruction.taskId as string)) invalid();

  try {
    switch (instruction.taskType) {
      case "navigate_to": {
        if (
          !hasOnlyKeys(instruction, ["taskId", "taskType", "target", "limits"])
        ) {
          invalid();
        }
        validatePositionShape(instruction.target);
        validateLimitsShape(instruction.limits);
        return;
      }
      case "verify_arrival":
        if (
          !hasOnlyKeys(instruction, [
            "taskId",
            "taskType",
            "expected",
            "tolerance",
          ])
        ) {
          invalid();
        }
        validatePositionShape(instruction.expected);
        if (
          typeof instruction.tolerance !== "number" ||
          !Number.isFinite(instruction.tolerance) ||
          instruction.tolerance < 0 ||
          instruction.tolerance > 1
        ) {
          invalid();
        }
        return;
      case "record_position":
        if (!hasOnlyKeys(instruction, ["taskId", "taskType"])) invalid();
        return;
      default:
        invalid();
    }
  } catch (error) {
    if (error instanceof SimpleWorkError) throw error;
    invalid();
  }
}
