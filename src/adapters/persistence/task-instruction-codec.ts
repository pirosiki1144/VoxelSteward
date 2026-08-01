import {
  validateBlockOperationInstruction,
  type PlaceSingleBlockInstruction,
} from "../../domain/block-operation/index.js";
import type { TaskInstruction } from "../../domain/task-queue/index.js";
import {
  validateSimpleWorkInstruction,
  type RecordPositionInstruction,
  type VerifyArrivalInstruction,
} from "../../domain/simple-work/index.js";

export class TaskInstructionCodecError extends Error {
  override readonly name = "TaskInstructionCodecError";
  readonly code = "INVALID_PERSISTED_TASK_INSTRUCTION";

  constructor() {
    super("Persisted task instruction is invalid");
  }
}

type TypedDetails = NonNullable<TaskInstruction["details"]>;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
};

const freezeBlockDetails = (
  instruction: PlaceSingleBlockInstruction,
): TypedDetails =>
  Object.freeze({
    version: 1,
    kind: "place_single_dirt",
    instruction: Object.freeze({
      ...instruction,
      target: Object.freeze({ ...instruction.target }),
      support: Object.freeze({
        ...instruction.support,
        position: Object.freeze({ ...instruction.support.position }),
      }),
    }),
  });

const freezeSimpleDetails = (
  kind: "verify_arrival" | "record_position",
  instruction: VerifyArrivalInstruction | RecordPositionInstruction,
): TypedDetails =>
  Object.freeze({
    version: 1,
    kind,
    instruction: Object.freeze({
      ...instruction,
      ...(instruction.taskType === "verify_arrival"
        ? { expected: Object.freeze({ ...instruction.expected }) }
        : {}),
    }),
  }) as TypedDetails;

export const encodeTaskInstructionDetails = (
  details: TaskInstruction["details"],
): { readonly version: number | null; readonly json: string | null } => {
  if (details === undefined) return { version: null, json: null };
  try {
    const candidate = record(details);
    if (
      candidate === undefined ||
      !hasExactKeys(candidate, ["version", "kind", "instruction"]) ||
      details.version !== 1 ||
      !["place_single_dirt", "verify_arrival", "record_position"].includes(
        details.kind,
      )
    )
      throw new Error();
    if (details.kind === "place_single_dirt")
      validateBlockOperationInstruction(details.instruction);
    else validateSimpleWorkInstruction(details.instruction);
    return { version: 1, json: JSON.stringify(details) };
  } catch {
    throw new TaskInstructionCodecError();
  }
};

export const decodeTaskInstructionDetails = (
  version: unknown,
  json: unknown,
): TaskInstruction["details"] => {
  if (version === null && json === null) return undefined;
  if (version !== 1 || json === null || json === undefined)
    throw new TaskInstructionCodecError();
  try {
    const parsed: unknown = typeof json === "string" ? JSON.parse(json) : json;
    const details = record(parsed);
    if (
      details === undefined ||
      !hasExactKeys(details, ["version", "kind", "instruction"]) ||
      details.version !== 1 ||
      typeof details.kind !== "string" ||
      !["place_single_dirt", "verify_arrival", "record_position"].includes(
        details.kind,
      )
    ) {
      throw new Error();
    }
    if (details.kind === "place_single_dirt") {
      validateBlockOperationInstruction(details.instruction);
      return freezeBlockDetails(details.instruction);
    }
    validateSimpleWorkInstruction(details.instruction);
    if (
      details.kind === "verify_arrival" &&
      details.instruction.taskType === "verify_arrival"
    )
      return freezeSimpleDetails(details.kind, details.instruction);
    if (
      details.kind === "record_position" &&
      details.instruction.taskType === "record_position"
    )
      return freezeSimpleDetails(details.kind, details.instruction);
    throw new Error();
  } catch {
    throw new TaskInstructionCodecError();
  }
};
