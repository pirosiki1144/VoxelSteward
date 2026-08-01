import { describe, expect, it } from "vitest";

import {
  OperatorTaskCommandError,
  parseOperatorTaskCommand,
} from "../src/application/operator-task/index.js";

describe("operator task command", () => {
  it("record_positionを厳格な型付き指示へ変換する", () => {
    expect(
      parseOperatorTaskCommand([
        "enqueue",
        "record-position",
        "--task-id",
        "record-1",
        "--schema-version",
        "1",
        "--priority",
        "10",
        "--max-attempts",
        "2",
      ]),
    ).toMatchObject({
      action: "enqueue",
      instruction: { taskType: "record_position", taskId: "record-1" },
    });
  });

  it("verify_arrivalを厳格な型付き指示へ変換する", () => {
    expect(
      parseOperatorTaskCommand([
        "enqueue",
        "verify-arrival",
        "--task-id",
        "verify-1",
        "--schema-version",
        "1",
        "--priority",
        "20",
        "--max-attempts",
        "1",
        "--x",
        "1",
        "--y",
        "71",
        "--z",
        "2",
        "--dimension",
        "overworld",
        "--tolerance",
        "0.5",
      ]),
    ).toMatchObject({
      action: "enqueue",
      instruction: {
        taskType: "verify_arrival",
        details: { instruction: { tolerance: 0.5 } },
      },
    });
  });

  it.each([
    ["enqueue", "unknown"],
    ["enqueue", "record-position", "--task-id", "x"],
    [
      "enqueue",
      "record-position",
      "--task-id",
      "x",
      "--schema-version",
      "2",
      "--priority",
      "1",
      "--max-attempts",
      "1",
    ],
    ["status", "--task-id", "x", "--extra", "forbidden"],
  ])("未知・欠損・余分なfieldを拒否する", (...args) => {
    expect(() => parseOperatorTaskCommand(args)).toThrowError(
      OperatorTaskCommandError,
    );
  });

  it("statusとcancelを受け付ける", () => {
    expect(parseOperatorTaskCommand(["status", "--task-id", "task-1"])).toEqual(
      {
        action: "status",
        taskId: "task-1",
      },
    );
    expect(parseOperatorTaskCommand(["cancel", "--task-id", "task-1"])).toEqual(
      {
        action: "cancel",
        taskId: "task-1",
      },
    );
  });
});
