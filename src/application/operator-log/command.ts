export type OperatorLogCommand =
  | { readonly action: "runs"; readonly limit: number }
  | { readonly action: "status"; readonly runId: string }
  | {
      readonly action: "history";
      readonly runId: string;
      readonly afterRevision: number;
      readonly limit: number;
    }
  | {
      readonly action: "checkpoints";
      readonly runId: string;
      readonly limit: number;
    };

export class OperatorLogCommandError extends Error {
  override readonly name = "OperatorLogCommandError";
  readonly code = "INVALID_OPERATOR_LOG_COMMAND";
  constructor() {
    super("Operator log command is invalid");
  }
}

const fail = (): never => {
  throw new OperatorLogCommandError();
};
const runIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const parseFlags = (values: readonly string[]): ReadonlyMap<string, string> => {
  if (values.length % 2 !== 0) fail();
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index] ?? fail();
    const value = values[index + 1] ?? fail();
    if (!key.startsWith("--") || result.has(key)) fail();
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
const integer = (
  value: string | undefined,
  min: number,
  max: number,
): number => {
  if (value === undefined || !/^\d+$/.test(value)) fail();
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) fail();
  return result;
};
const runId = (value: string | undefined): string => {
  if (value === undefined || !runIdPattern.test(value)) fail();
  return value ?? fail();
};

export const parseOperatorLogCommand = (
  argv: readonly string[],
): OperatorLogCommand => {
  const [action, ...rest] = argv;
  const input = parseFlags(rest);
  if (action === "runs") {
    exact(input, ["--limit"]);
    return Object.freeze({
      action,
      limit: integer(input.get("--limit"), 1, 100),
    });
  }
  if (action === "status") {
    exact(input, ["--run-id"]);
    return Object.freeze({ action, runId: runId(input.get("--run-id")) });
  }
  if (action === "history") {
    exact(input, ["--run-id", "--after-revision", "--limit"]);
    return Object.freeze({
      action,
      runId: runId(input.get("--run-id")),
      afterRevision: integer(
        input.get("--after-revision"),
        0,
        Number.MAX_SAFE_INTEGER,
      ),
      limit: integer(input.get("--limit"), 1, 500),
    });
  }
  if (action === "checkpoints") {
    exact(input, ["--run-id", "--limit"]);
    return Object.freeze({
      action,
      runId: runId(input.get("--run-id")),
      limit: integer(input.get("--limit"), 1, 500),
    });
  }
  return fail();
};
