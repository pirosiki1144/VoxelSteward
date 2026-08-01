import type { TaskInstruction } from "../../domain/task-queue/index.js";

export type OperatorTaskCommand =
  | { readonly action: "enqueue"; readonly instruction: TaskInstruction }
  | { readonly action: "cancel"; readonly taskId: string }
  | { readonly action: "status"; readonly taskId: string };

export class OperatorTaskCommandError extends Error {
  override readonly name = "OperatorTaskCommandError";
  readonly code = "INVALID_OPERATOR_TASK_COMMAND";
  constructor() {
    super("Operator task command is invalid");
  }
}

const fail = (): never => {
  throw new OperatorTaskCommandError();
};
const idPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const flags = (values: readonly string[]): ReadonlyMap<string, string> => {
  if (values.length % 2 !== 0) fail();
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index] ?? fail();
    const value = values[index + 1] ?? fail();
    if (!key.startsWith("--")) fail();
    if (result.has(key)) fail();
    result.set(key, value);
  }
  return result;
};

const exact = (
  input: ReadonlyMap<string, string>,
  expected: readonly string[],
): void => {
  if (input.size !== expected.length || expected.some((key) => !input.has(key)))
    fail();
};

const taskId = (value: string | undefined): string => {
  if (value === undefined || !idPattern.test(value)) fail();
  return value ?? fail();
};
const number = (value: string | undefined): number => {
  if (value === undefined || value.trim() === "") fail();
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) fail();
  return parsed;
};
const integer = (
  value: string | undefined,
  min: number,
  max: number,
): number => {
  const parsed = number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) fail();
  return parsed;
};
const dimension = (
  value: string | undefined,
): "overworld" | "nether" | "end" => {
  switch (value) {
    case "overworld":
    case "nether":
    case "end":
      return value;
    default:
      return fail();
  }
};

export const parseOperatorTaskCommand = (
  argv: readonly string[],
): OperatorTaskCommand => {
  const [action, kind, ...rest] = argv;
  if (action === "status" || action === "cancel") {
    if (kind === undefined || kind !== "--task-id") fail();
    const input = flags(["--task-id", ...rest]);
    exact(input, ["--task-id"]);
    return Object.freeze({ action, taskId: taskId(input.get("--task-id")) });
  }
  if (action !== "enqueue") fail();
  const input = flags(rest);
  const common = [
    "--task-id",
    "--schema-version",
    "--priority",
    "--max-attempts",
  ];
  if (kind === "record-position") {
    exact(input, common);
    const id = taskId(input.get("--task-id"));
    if (input.get("--schema-version") !== "1") fail();
    return Object.freeze({
      action: "enqueue",
      instruction: Object.freeze({
        taskId: id,
        taskType: "record_position",
        priority: integer(input.get("--priority"), 0, 100),
        maxAttempts: integer(input.get("--max-attempts"), 1, 10),
        details: Object.freeze({
          version: 1,
          kind: "record_position",
          instruction: Object.freeze({
            taskId: id,
            taskType: "record_position",
          }),
        }),
      }),
    });
  }
  if (kind === "verify-arrival") {
    exact(input, [
      ...common,
      "--x",
      "--y",
      "--z",
      "--dimension",
      "--tolerance",
    ]);
    const id = taskId(input.get("--task-id"));
    if (input.get("--schema-version") !== "1") fail();
    const expected = Object.freeze({
      x: number(input.get("--x")),
      y: number(input.get("--y")),
      z: number(input.get("--z")),
      dimension: dimension(input.get("--dimension")),
    });
    return Object.freeze({
      action: "enqueue",
      instruction: Object.freeze({
        taskId: id,
        taskType: "verify_arrival",
        priority: integer(input.get("--priority"), 0, 100),
        maxAttempts: integer(input.get("--max-attempts"), 1, 10),
        details: Object.freeze({
          version: 1,
          kind: "verify_arrival",
          instruction: Object.freeze({
            taskId: id,
            taskType: "verify_arrival",
            expected,
            tolerance: number(input.get("--tolerance")),
          }),
        }),
      }),
    });
  }
  return fail();
};
