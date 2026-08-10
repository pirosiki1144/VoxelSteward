import { describe, expect, it } from "vitest";

import {
  OperatorLogCommandError,
  parseOperatorLogCommand,
} from "../src/application/operator-log/index.js";

const runId = "00000000-0000-4000-8000-000000000001";
const invalidCommands: readonly (readonly string[])[] = [
  [],
  ["runs"],
  ["runs", "--limit", "0"],
  ["runs", "--limit", "101"],
  ["status", "--run-id", "not-a-run"],
  ["history", "--run-id", runId, "--after-revision", "-1", "--limit", "1"],
  ["history", "--run-id", runId, "--after-revision", "0", "--limit", "501"],
  ["checkpoints", "--run-id", runId, "--limit", "1", "--extra", "value"],
  ["unknown", "--limit", "1"],
];

describe("operator log command", () => {
  it("runs、status、history、checkpointsを厳密に解釈する", () => {
    expect(parseOperatorLogCommand(["runs", "--limit", "20"])).toEqual({
      action: "runs",
      limit: 20,
    });
    expect(parseOperatorLogCommand(["status", "--run-id", runId])).toEqual({
      action: "status",
      runId,
    });
    expect(
      parseOperatorLogCommand([
        "history",
        "--run-id",
        runId,
        "--after-revision",
        "12",
        "--limit",
        "50",
      ]),
    ).toEqual({ action: "history", runId, afterRevision: 12, limit: 50 });
    expect(
      parseOperatorLogCommand([
        "checkpoints",
        "--run-id",
        runId,
        "--limit",
        "10",
      ]),
    ).toEqual({ action: "checkpoints", runId, limit: 10 });
  });

  it.each(invalidCommands.map((argv) => [argv] as const))(
    "不正・余分な入力を拒否する: %j",
    (argv) => {
      expect(() => parseOperatorLogCommand(argv)).toThrow(
        OperatorLogCommandError,
      );
    },
  );
});
