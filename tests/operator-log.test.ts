import { describe, expect, it, vi } from "vitest";

import { runOperatorLog } from "../src/operator-log.js";
import type { OperationalLogRepository } from "../src/ports/operational-log-repository.js";

const runId = "00000000-0000-4000-8000-000000000001";
const state = {
  runId,
  startedAt: "2026-08-05T00:00:00.000Z",
  revision: 4,
  updatedAt: "2026-08-05T00:01:00.000Z",
  runtime: "ready" as const,
  minecraftConnection: "spawned" as const,
  spawnCompleted: true,
  telemetryStatus: "valid" as const,
  position: { x: 1, y: 71, z: 2 },
  dimension: "overworld" as const,
  health: 20,
  hunger: 20,
  otherPlayerDetected: false,
};

const repository = (): OperationalLogRepository => ({
  listRuns: vi.fn().mockResolvedValue([state]),
  findRun: vi.fn().mockResolvedValue(state),
  listHistory: vi.fn().mockResolvedValue([
    {
      ...state,
      occurredAt: "2026-08-05T00:01:00.000Z",
      cause: "minecraft.telemetry.update",
    },
  ]),
  listCheckpoints: vi.fn().mockResolvedValue([
    {
      taskId: "task-1",
      revision: 4,
      taskType: "record_position",
      taskState: "completed",
      updatedAt: "2026-08-05T00:01:00.000Z",
    },
  ]),
});

describe("operator log entrypoint", () => {
  it("allow-list済みの状態と履歴だけをJSON recordとして出力する", async () => {
    const output: Readonly<Record<string, unknown>>[] = [];
    const close = vi.fn().mockResolvedValue(undefined);
    const result = await runOperatorLog(
      ["history", "--run-id", runId, "--after-revision", "0", "--limit", "10"],
      {
        createBinding: () => ({ repository: repository(), close }),
        write: (record) => output.push(record),
      },
    );
    expect(result).toBe(0);
    expect(output).toEqual([
      expect.objectContaining({
        event: "operator_log.history",
        revision: 4,
        cause: "minecraft.telemetry.update",
      }),
    ]);
    expect(JSON.stringify(output)).not.toMatch(
      /playerName|botAccount|serverEndpoint|password|token|stack/i,
    );
    expect(close).toHaveBeenCalledOnce();
  });

  it("不正commandではDB bindingを作らず固定errorだけを出力する", async () => {
    const createBinding = vi.fn();
    const output: Readonly<Record<string, unknown>>[] = [];
    expect(
      await runOperatorLog(["history", "--unexpected", "value"], {
        createBinding,
        write: (record) => output.push(record),
      }),
    ).toBe(1);
    expect(createBinding).not.toHaveBeenCalled();
    expect(output).toEqual([
      {
        event: "operator_log.error",
        code: "INVALID_OPERATOR_LOG_COMMAND",
      },
    ]);
  });

  it("DB障害を固定errorへ隔離しbindingをcloseする", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    const failing: OperationalLogRepository = {
      ...repository(),
      listRuns: vi
        .fn()
        .mockRejectedValue(new Error("sensitive database failure")),
    };
    const output: Readonly<Record<string, unknown>>[] = [];
    expect(
      await runOperatorLog(["runs", "--limit", "1"], {
        createBinding: () => ({ repository: failing, close }),
        write: (record) => output.push(record),
      }),
    ).toBe(1);
    expect(output).toEqual([
      { event: "operator_log.error", code: "OPERATOR_LOG_FAILED" },
    ]);
    expect(close).toHaveBeenCalledOnce();
  });
});
