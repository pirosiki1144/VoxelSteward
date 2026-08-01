import { describe, expect, it } from "vitest";

import {
  decodeTaskInstructionDetails,
  encodeTaskInstructionDetails,
  TaskInstructionCodecError,
} from "../src/adapters/persistence/task-instruction-codec.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import type { PlaceSingleBlockInstruction } from "../src/domain/block-operation/index.js";
import {
  taskRecoveryDisposition,
  type TaskInstruction,
} from "../src/domain/task-queue/index.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const operation = (): PlaceSingleBlockInstruction => ({
  schemaVersion: 1,
  taskId: "persisted-block-1",
  taskType: "place_single_dirt",
  operation: "place",
  target: { x: 1, y: 71, z: 0, dimension: "overworld" },
  blockType: "dirt",
  expectedBefore: "air",
  expectedAfter: "dirt",
  support: {
    position: { x: 1, y: 70, z: 0, dimension: "overworld" },
    expected: "solid",
    face: "up",
  },
  maxReach: 3,
  timeoutMs: 5_000,
});

const task = (): TaskInstruction => ({
  taskId: "persisted-block-1",
  taskType: "place_single_dirt",
  priority: 10,
  maxAttempts: 1,
  details: {
    version: 1,
    kind: "place_single_dirt",
    instruction: operation(),
  },
});

describe("typed task instruction codec", () => {
  it("version 1を完全復元しnested valueをfreezeする", () => {
    const encoded = encodeTaskInstructionDetails(task().details);
    const decoded = decodeTaskInstructionDetails(encoded.version, encoded.json);
    expect(decoded).toEqual(task().details);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded?.instruction)).toBe(true);
    expect(Object.isFrozen(decoded?.instruction.target)).toBe(true);
    expect(Object.isFrozen(decoded?.instruction.support.position)).toBe(true);
  });

  it.each([
    [2, JSON.stringify(task().details)],
    [1, "{"],
    [1, JSON.stringify({ ...task().details, extra: "token" })],
    [
      1,
      JSON.stringify({ version: 1, kind: "unknown", instruction: operation() }),
    ],
    [
      1,
      JSON.stringify({
        ...task().details,
        instruction: { ...operation(), endpoint: "forbidden" },
      }),
    ],
  ])(
    "unknown・malformed・余分なfieldをfail-closedに拒否する",
    (version, json) => {
      expect(() => decodeTaskInstructionDetails(version, json)).toThrowError(
        TaskInstructionCodecError,
      );
    },
  );

  it("legacy taskは両方nullで表現する", () => {
    expect(encodeTaskInstructionDetails(undefined)).toEqual({
      version: null,
      json: null,
    });
    expect(decodeTaskInstructionDetails(null, null)).toBeUndefined();
  });

  it("encode時も型を迂回した余分なfieldを保存しない", () => {
    const unsafe = { ...task().details!, webhookUrl: "forbidden" };
    expect(() =>
      encodeTaskInstructionDetails(
        unsafe as unknown as TaskInstruction["details"],
      ),
    ).toThrowError(TaskInstructionCodecError);
  });
});

describe("typed task lifecycle", () => {
  it("maxAttempts=1を強制しdelivery開始点とserver検証を永続状態化する", async () => {
    const repository = new FakeTaskQueueRepository();
    const queue = new TaskQueueService(repository);
    await queue.dispatch({ type: "task.enqueue", instruction: task() });
    const claimed = (await queue.dispatch({ type: "task.claim_next" })).item!;
    expect(taskRecoveryDisposition(claimed)).toBe("manual_review");
    expect(claimed.executionPhase).toBe("not_started");
    expect(
      (
        await queue.dispatch({
          type: "task.mark_delivery_started",
          taskId: claimed.taskId,
        })
      ).item?.executionPhase,
    ).toBe("delivery_started");
    expect(
      (
        await queue.dispatch({
          type: "task.mark_verified",
          taskId: claimed.taskId,
        })
      ).item?.executionPhase,
    ).toBe("verified");
  });

  it("typed taskの欠損・ID不一致・再試行設定を拒否する", async () => {
    const queue = new TaskQueueService(new FakeTaskQueueRepository());
    for (const instruction of [
      { ...task(), details: undefined },
      { ...task(), maxAttempts: 2 },
      {
        ...task(),
        details: {
          ...task().details!,
          instruction: { ...operation(), taskId: "different" },
        },
      },
    ]) {
      await expect(
        queue.dispatch({ type: "task.enqueue", instruction }),
      ).rejects.toMatchObject({ code: "INVALID_TASK_INSTRUCTION" });
    }
  });

  it("claimed taskを新しいserviceから再claimしない", async () => {
    const repository = new FakeTaskQueueRepository();
    const first = new TaskQueueService(repository);
    await first.dispatch({ type: "task.enqueue", instruction: task() });
    await first.dispatch({ type: "task.claim_next" });
    const restarted = new TaskQueueService(repository);
    expect(
      (await restarted.dispatch({ type: "task.claim_next" })).item,
    ).toBeUndefined();
  });

  it("同じtyped instructionだけ冪等とし同じIDの異なる内容を拒否する", async () => {
    const queue = new TaskQueueService(new FakeTaskQueueRepository());
    const first = await queue.dispatch({
      type: "task.enqueue",
      instruction: task(),
    });
    const duplicate = await queue.dispatch({
      type: "task.enqueue",
      instruction: task(),
    });
    expect(duplicate.item).toEqual(first.item);
    await expect(
      queue.dispatch({
        type: "task.enqueue",
        instruction: { ...task(), priority: 11 },
      }),
    ).rejects.toThrowError("task instruction conflict");
  });

  it("並行delivery開始CASは1件だけを成功させる", async () => {
    const repository = new FakeTaskQueueRepository();
    const first = new TaskQueueService(repository);
    const second = new TaskQueueService(repository);
    await first.dispatch({ type: "task.enqueue", instruction: task() });
    await first.dispatch({ type: "task.claim_next" });
    const outcomes = await Promise.allSettled([
      first.dispatch({
        type: "task.mark_delivery_started",
        taskId: "persisted-block-1",
      }),
      second.dispatch({
        type: "task.mark_delivery_started",
        taskId: "persisted-block-1",
      }),
    ]);
    expect(
      outcomes.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
  });
});
