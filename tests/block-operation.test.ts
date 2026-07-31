import { describe, expect, it } from "vitest";

import { BlockOperationCoordinator } from "../src/application/block-operation/index.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import {
  BlockOperationError,
  validateBlockOperationInstruction,
  type BlockObservation,
  type PlaceSingleBlockInstruction,
} from "../src/domain/block-operation/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import type { StateCommand } from "../src/domain/state/index.js";
import { BlockOperationPortError } from "../src/ports/block-operation-port.js";
import { FakeBlockOperationPort } from "./fakes/fake-block-operation-port.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const target = { x: 1, y: 71, z: 0, dimension: "overworld" as const };
const support = { x: 1, y: 70, z: 0, dimension: "overworld" as const };
const observation = (
  position = target,
  blockType: BlockObservation["blockType"] = "air",
): BlockObservation => ({ position, blockType });
const instruction = (
  overrides: Partial<PlaceSingleBlockInstruction> = {},
): PlaceSingleBlockInstruction => ({
  taskId: "block-1",
  taskType: "place_single_dirt",
  operation: "place",
  target: { ...target },
  blockType: "dirt",
  expectedBefore: "air",
  expectedAfter: "dirt",
  support: { position: { ...support }, expected: "solid", face: "up" },
  maxReach: 3,
  timeoutMs: 5_000,
  ...overrides,
});

const pendingWait = (_delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

async function setup(
  port = new FakeBlockOperationPort([
    observation(),
    observation(support, "solid_other"),
    observation(target, "dirt"),
  ]),
  taskType = "place_single_dirt",
) {
  const state = createStateStore();
  state.dispatch({ type: "runtime.transition", to: "connecting" });
  state.dispatch({ type: "minecraft.connection.transition", to: "connecting" });
  state.dispatch({ type: "minecraft.connection.transition", to: "connected" });
  state.dispatch({ type: "minecraft.spawn.update", completed: true });
  state.dispatch({
    type: "minecraft.telemetry.update",
    telemetry: {
      position: { x: 0, y: 71, z: 0 },
      dimension: "overworld",
      health: 20,
      hunger: 20,
    },
  });
  state.dispatch({ type: "runtime.transition", to: "ready" });
  const repository = new FakeTaskQueueRepository();
  const queue = new TaskQueueService(repository);
  await queue.dispatch({
    type: "task.enqueue",
    instruction: { taskId: "block-1", taskType, priority: 1, maxAttempts: 1 },
  });
  await queue.dispatch({ type: "task.claim_next" });
  const coordinator = new BlockOperationCoordinator({
    port,
    stateStore: state,
    safetyPolicy: new DefaultWorkSafetyPolicy(),
    taskQueue: queue,
    wait: pendingWait,
  });
  return { coordinator, port, queue, repository, state };
}

describe("block operation validation", () => {
  it("単一dirt配置の厳格な形だけを受理する", () => {
    expect(() =>
      validateBlockOperationInstruction(instruction()),
    ).not.toThrow();
    for (const invalid of [
      { ...instruction(), operation: "break" },
      { ...instruction(), blockType: "stone" },
      { ...instruction(), target: { ...target, x: 1.5 } },
      { ...instruction(), target: { ...target, x: 30_000_001 } },
      { ...instruction(), target: { ...target, dimension: "nether" } },
      { ...instruction(), maxReach: 3.1 },
      { ...instruction(), timeoutMs: 30_001 },
      { ...instruction(), extra: [] },
      { ...instruction(), targets: [target] },
    ]) {
      expect(() => validateBlockOperationInstruction(invalid)).toThrowError(
        BlockOperationError,
      );
    }
  });

  it("supportをtarget直下の同dimensionに固定する", () => {
    expect(() =>
      validateBlockOperationInstruction(
        instruction({
          support: { position: target, expected: "solid", face: "up" },
        }),
      ),
    ).toThrowError(BlockOperationError);
  });
});

describe("BlockOperationCoordinator", () => {
  it("server観測したairへ1回だけ配置しdirt観測後に完了する", async () => {
    const { coordinator, port, repository, state } = await setup();
    const result = await coordinator.execute(instruction());
    expect(result).toMatchObject({
      outcome: "completed",
      observation: { blockType: "dirt" },
    });
    expect(Object.isFrozen(result)).toBe(true);
    if (result.outcome === "completed") {
      expect(Object.isFrozen(result.observation)).toBe(true);
      expect(Object.isFrozen(result.observation.position)).toBe(true);
    }
    expect(port.placements).toHaveLength(1);
    expect(port.observations).toEqual([target, support, target]);
    expect(state.getSnapshot().task.state).toBe("completed");
    expect(await repository.find("block-1")).toMatchObject({
      status: "completed",
    });
  });

  it("claimされていないtaskまたは型不一致では観測も配置もしない", async () => {
    const context = await setup(undefined, "movement");
    expect(await context.coordinator.execute(instruction())).toMatchObject({
      outcome: "failed",
      reason: "task_not_claimed",
    });
    expect(context.port.observations).toHaveLength(0);
    expect(context.port.placements).toHaveLength(0);
  });

  it("異dimensionまたは距離超過ではfail-closedする", async () => {
    for (const targetOverride of [
      { ...target, dimension: "nether" as const },
      { ...target, x: 4 },
    ]) {
      const context = await setup();
      const supportOverride = {
        ...targetOverride,
        y: targetOverride.y - 1,
      };
      expect(
        await context.coordinator.execute(
          instruction({
            target: targetOverride,
            support: {
              position: supportOverride,
              expected: "solid",
              face: "up",
            },
          }),
        ),
      ).toMatchObject({ outcome: "failed", reason: "out_of_reach" });
      expect(context.port.placements).toHaveLength(0);
    }
  });

  it("targetがairでない、supportがない、postcondition不一致を拒否する", async () => {
    const cases: Array<[BlockObservation[], string]> = [
      [[observation(target, "solid_other")], "unexpected_before"],
      [[observation(), observation(support, "air")], "unsupported_support"],
      [
        [
          observation(),
          observation(support, "solid_other"),
          observation(target, "air"),
        ],
        "unexpected_after",
      ],
    ];
    for (const [responses, reason] of cases) {
      const context = await setup(new FakeBlockOperationPort(responses));
      expect(await context.coordinator.execute(instruction())).toMatchObject({
        outcome: "failed",
        reason,
      });
      expect(context.port.placements).toHaveLength(
        reason === "unexpected_after" ? 1 : 0,
      );
    }
  });

  it("各安全条件を満たさない場合は操作せずstoppedにする", async () => {
    const commands: StateCommand[] = [
      { type: "safety.other_player_detected" },
      { type: "runtime.stop_reason.record", reason: "signal_sigterm" },
      {
        type: "minecraft.telemetry.update" as const,
        telemetry: { health: 9 },
      },
      {
        type: "minecraft.telemetry.update" as const,
        telemetry: { hunger: 5 },
      },
    ];
    for (const command of commands) {
      const context = await setup();
      context.state.dispatch(command);
      expect(await context.coordinator.execute(instruction())).toMatchObject({
        outcome: "stopped",
        reason: "safety_stop",
      });
      expect(context.port.placements).toHaveLength(0);
    }
  });

  it("pre-observation後の安全状態変化を直前再評価して操作しない", async () => {
    const port = new FakeBlockOperationPort([
      observation(),
      observation(support, "solid_other"),
    ]);
    const context = await setup(port);
    const originalObserve = port.observe.bind(port);
    let calls = 0;
    port.observe = async (position, signal) => {
      const result = await originalObserve(position, signal);
      calls += 1;
      if (calls === 2) {
        context.state.dispatch({ type: "safety.other_player_detected" });
      }
      return result;
    };
    expect(await context.coordinator.execute(instruction())).toMatchObject({
      outcome: "stopped",
      reason: "safety_stop",
    });
    expect(port.placements).toHaveLength(0);
  });

  it("検証後に呼出元instructionを変更してもcanonical commandだけを使う", async () => {
    const port = new FakeBlockOperationPort([
      observation(support, "solid_other"),
      observation(target, "dirt"),
    ]);
    let release: ((value: BlockObservation) => void) | undefined;
    const originalObserve = port.observe.bind(port);
    let first = true;
    port.observe = (position, signal) => {
      if (first) {
        first = false;
        port.observations.push(Object.freeze({ ...position }));
        return new Promise<BlockObservation>((resolve, reject) => {
          release = resolve;
          signal.addEventListener("abort", () => reject(new Error("abort")), {
            once: true,
          });
        });
      }
      return originalObserve(position, signal);
    };
    const context = await setup(port);
    const mutable = instruction() as unknown as {
      target: { x: number };
      blockType: string;
    };
    const running = context.coordinator.execute(
      mutable as unknown as PlaceSingleBlockInstruction,
    );
    for (let index = 0; index < 20 && release === undefined; index += 1) {
      await Promise.resolve();
    }
    expect(release).toBeDefined();
    mutable.target.x = 99;
    mutable.blockType = "stone";
    release?.(observation());
    expect(await running).toMatchObject({ outcome: "completed" });
    expect(port.placements).toHaveLength(1);
    expect(port.placements[0]).toMatchObject({ blockType: "dirt", target });
  });

  it("pending配置中の安全状態変化でabortし事後観測しない", async () => {
    const port = new FakeBlockOperationPort([
      observation(),
      observation(support, "solid_other"),
    ]);
    port.placeHandler = (_instruction, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        }),
      );
    const context = await setup(port);
    const running = context.coordinator.execute(instruction());
    for (
      let index = 0;
      index < 50 && port.placements.length === 0;
      index += 1
    ) {
      await Promise.resolve();
    }
    expect(port.placements).toHaveLength(1);
    context.state.dispatch({ type: "safety.other_player_detected" });
    expect(await running).toMatchObject({
      outcome: "stopped",
      reason: "safety_stop",
    });
    expect(port.stopCalls).toBe(1);
    expect(port.observations).toHaveLength(2);
  });

  it("timeout・disconnect・port failureを再試行しない", async () => {
    const timeoutPort = new FakeBlockOperationPort([observation()]);
    timeoutPort.observe = (_position, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        }),
      );
    const timeoutContext = await setup(timeoutPort);
    const timeoutCoordinator = new BlockOperationCoordinator({
      port: timeoutPort,
      stateStore: timeoutContext.state,
      safetyPolicy: new DefaultWorkSafetyPolicy(),
      taskQueue: timeoutContext.queue,
      wait: () => Promise.resolve(),
    });
    expect(await timeoutCoordinator.execute(instruction())).toMatchObject({
      outcome: "failed",
      reason: "timeout",
    });
    expect(timeoutPort.placements).toHaveLength(0);

    const disconnectPort = new FakeBlockOperationPort([
      observation(),
      observation(support, "solid_other"),
    ]);
    disconnectPort.placeError = new BlockOperationPortError("disconnected");
    const disconnect = await setup(disconnectPort);
    expect(await disconnect.coordinator.execute(instruction())).toMatchObject({
      outcome: "failed",
      reason: "disconnected",
    });
    expect(disconnectPort.placements).toHaveLength(1);
  });

  it("cancelは一度だけstopし後続送信しない", async () => {
    const port = new FakeBlockOperationPort([
      observation(),
      observation(support, "solid_other"),
    ]);
    port.placeHandler = (_instruction, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        }),
      );
    const context = await setup(port);
    const running = context.coordinator.execute(instruction());
    await Promise.resolve();
    await Promise.resolve();
    context.coordinator.cancel();
    context.coordinator.cancel();
    expect(await running).toMatchObject({
      outcome: "stopped",
      reason: "cancelled",
    });
    expect(port.placements.length).toBeLessThanOrEqual(1);
    expect(port.stopCalls).toBe(1);
    expect(port.observations.length).toBeLessThanOrEqual(2);
  });

  it("重複開始を拒否する", async () => {
    const port = new FakeBlockOperationPort([observation()]);
    port.observe = (_position, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("abort")), {
          once: true,
        }),
      );
    const context = await setup(port);
    const first = context.coordinator.execute(instruction());
    await Promise.resolve();
    await expect(
      context.coordinator.execute(instruction()),
    ).rejects.toMatchObject({
      code: "BLOCK_OPERATION_ALREADY_ACTIVE",
    });
    context.coordinator.cancel();
    await first;
  });

  it("別taskのStateStoreを終端化せずqueue finalization failureを有限化する", async () => {
    const context = await setup();
    context.state.dispatch({
      type: "task.prepare",
      taskId: "other",
      taskType: "other",
    });
    expect(await context.coordinator.execute(instruction())).toMatchObject({
      outcome: "failed",
      reason: "task_state_conflict",
    });
    expect(context.state.getSnapshot().task).toMatchObject({
      id: "other",
      state: "preparing",
    });
    expect(await context.repository.find("block-1")).toMatchObject({
      status: "failed",
    });

    const finalized = await setup();
    finalized.repository.replaceError = new Error("db unavailable");
    expect(await finalized.coordinator.execute(instruction())).toMatchObject({
      outcome: "failed",
      reason: "finalization_error",
    });
    expect(finalized.port.placements).toHaveLength(1);
  });

  it("progress listenerの例外を隔離する", async () => {
    const context = await setup();
    await expect(
      context.coordinator.execute(instruction(), () => {
        throw new Error("listener failed");
      }),
    ).resolves.toMatchObject({ outcome: "completed" });
  });
});
