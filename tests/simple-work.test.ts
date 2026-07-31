import { describe, expect, it, vi } from "vitest";

import { SimpleWorkCoordinator } from "../src/application/simple-work/index.js";
import {
  SimpleWorkError,
  validateSimpleWorkInstruction,
  type NavigateToInstruction,
  type SimpleWorkProgress,
} from "../src/domain/simple-work/index.js";

const target = { x: 2, y: 71, z: 3, dimension: "overworld" as const };
const limits = {
  maxStepDistance: 1,
  maxSteps: 10,
  stepTimeoutMs: 5_000,
  arrivalTolerance: 0.05,
};
const navigate: NavigateToInstruction = {
  taskId: "work-1",
  taskType: "navigate_to",
  target,
  limits,
};

describe("simple work domain", () => {
  it("3種類のblock-free instructionを検証する", () => {
    expect(() => validateSimpleWorkInstruction(navigate)).not.toThrow();
    expect(() =>
      validateSimpleWorkInstruction({
        taskId: "work-2",
        taskType: "verify_arrival",
        expected: target,
        tolerance: 0.1,
      }),
    ).not.toThrow();
    expect(() =>
      validateSimpleWorkInstruction({
        taskId: "work-3",
        taskType: "record_position",
      }),
    ).not.toThrow();
  });

  it("不正ID、座標、許容差、移動上限を拒否する", () => {
    const invalidInstructions = [
      { ...navigate, taskId: "contains space" },
      { ...navigate, target: { ...target, x: Number.NaN } },
      { ...navigate, limits: { ...limits, maxStepDistance: 2 } },
      {
        taskId: "work-2",
        taskType: "verify_arrival" as const,
        expected: target,
        tolerance: 1.1,
      },
    ];
    for (const instruction of invalidInstructions) {
      expect(() => validateSimpleWorkInstruction(instruction)).toThrowError(
        SimpleWorkError,
      );
    }
  });

  it("任意payloadとネストした余分なfieldを拒否する", () => {
    const invalidInstructions: unknown[] = [
      { ...navigate, payload: { action: "break" } },
      { ...navigate, target: { ...target, extra: "unexpected" } },
      { ...navigate, limits: { ...limits, retry: true } },
      {
        taskId: "work-2",
        taskType: "record_position",
        extra: "unexpected",
      },
    ];
    for (const instruction of invalidInstructions) {
      expect(() => validateSimpleWorkInstruction(instruction)).toThrowError(
        SimpleWorkError,
      );
    }
  });
});

describe("SimpleWorkCoordinator", () => {
  it("navigate_toだけをMovementCoordinator境界へ委譲する", async () => {
    const execute = vi.fn().mockResolvedValue({
      outcome: "completed",
      stepsCompleted: 2,
      finalPosition: target,
    });
    const readPosition = vi.fn(() => ({ ...target, x: 0, z: 0 }));
    const progress: SimpleWorkProgress[] = [];
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute },
      readPosition,
    });

    await expect(
      coordinator.execute(navigate, (event) => progress.push(event)),
    ).resolves.toEqual({
      outcome: "completed",
      taskType: "navigate_to",
      position: target,
      stepsCompleted: 2,
    });
    expect(execute).toHaveBeenCalledWith({
      taskId: "work-1",
      taskType: "navigate_to",
      target,
      limits,
    });
    expect(readPosition).toHaveBeenCalledTimes(1);
    expect(progress.map(({ phase }) => phase)).toEqual([
      "validated",
      "executing",
      "completed",
    ]);
  });

  it("verify_arrivalは観測位置だけで判定しmovementを呼ばない", async () => {
    const execute = vi.fn();
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute },
      readPosition: () => ({ ...target, x: 2.05 }),
    });
    await expect(
      coordinator.execute({
        taskId: "work-2",
        taskType: "verify_arrival",
        expected: target,
        tolerance: 0.1,
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      taskType: "verify_arrival",
      arrived: true,
      position: { x: 2.05 },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("record_positionは観測値をimmutableな結果として返す", async () => {
    const observed = { ...target };
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute: vi.fn() },
      readPosition: () => observed,
    });
    const result = await coordinator.execute({
      taskId: "work-3",
      taskType: "record_position",
    });
    expect(result).toMatchObject({
      outcome: "completed",
      taskType: "record_position",
      position: target,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(
      result.outcome === "completed" ? Object.isFrozen(result.position) : false,
    ).toBe(true);
  });

  it("観測位置なし・不正位置はfail-closedにする", async () => {
    const movement = { execute: vi.fn() };
    const instruction = {
      taskId: "work-3",
      taskType: "record_position" as const,
    };
    await expect(
      new SimpleWorkCoordinator({
        movement,
        readPosition: () => undefined,
      }).execute(instruction),
    ).resolves.toMatchObject({
      outcome: "failed",
      reason: "position_unavailable",
    });
    await expect(
      new SimpleWorkCoordinator({
        movement,
        readPosition: () => ({ ...target, y: 999 }),
      }).execute(instruction),
    ).resolves.toMatchObject({
      outcome: "failed",
      reason: "invalid_observed_position",
    });
    expect(movement.execute).not.toHaveBeenCalled();
  });

  it("不正instructionはmovementもposition readerも呼ばない", async () => {
    const execute = vi.fn();
    const readPosition = vi.fn();
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute },
      readPosition,
    });
    await expect(
      coordinator.execute({ ...navigate, taskId: "" }),
    ).resolves.toMatchObject({
      outcome: "failed",
      reason: "invalid_instruction",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(readPosition).not.toHaveBeenCalled();
  });

  it("navigate_toの安全停止とcancelをそのまま有限結果へ変換する", async () => {
    for (const reason of ["safety_stop", "cancelled"] as const) {
      const coordinator = new SimpleWorkCoordinator({
        movement: {
          execute: vi.fn().mockResolvedValue({
            outcome: "stopped",
            reason,
            stepsCompleted: 1,
          }),
        },
        readPosition: () => ({ ...target, x: 0, z: 0 }),
      });
      await expect(coordinator.execute(navigate)).resolves.toEqual({
        outcome: "stopped",
        taskType: "navigate_to",
        reason,
        stepsCompleted: 1,
      });
    }
  });

  it("navigate_toのport障害を成功に変換しない", async () => {
    const coordinator = new SimpleWorkCoordinator({
      movement: {
        execute: vi.fn().mockResolvedValue({
          outcome: "failed",
          reason: "movement_port_error",
          stepsCompleted: 0,
        }),
      },
      readPosition: () => ({ ...target, x: 0, z: 0 }),
    });
    await expect(coordinator.execute(navigate)).resolves.toEqual({
      outcome: "failed",
      taskType: "navigate_to",
      reason: "movement_port_error",
      stepsCompleted: 0,
    });
  });

  it("movement境界とprogress callbackの例外を隔離する", async () => {
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute: vi.fn().mockRejectedValue(new Error("unsafe")) },
      readPosition: () => ({ ...target, x: 0, z: 0 }),
    });
    await expect(
      coordinator.execute(navigate, () => {
        throw new Error("observer failure");
      }),
    ).resolves.toEqual({
      outcome: "failed",
      taskType: "navigate_to",
      reason: "movement_port_error",
      stepsCompleted: 0,
    });
  });

  it("垂直・異dimensionのnavigate_toをmovementへ渡さない", async () => {
    const execute = vi.fn();
    const coordinator = new SimpleWorkCoordinator({
      movement: { execute },
      readPosition: () => ({ x: 0, y: 71, z: 0, dimension: "overworld" }),
    });
    for (const unsafeTarget of [
      { ...target, y: 72 },
      { ...target, dimension: "nether" as const },
    ]) {
      await expect(
        coordinator.execute({ ...navigate, target: unsafeTarget }),
      ).resolves.toMatchObject({
        outcome: "failed",
        reason: "unsupported_navigation",
      });
    }
    expect(execute).not.toHaveBeenCalled();
  });
});
