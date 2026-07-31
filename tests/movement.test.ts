import { describe, expect, it } from "vitest";

import { MovementCoordinator } from "../src/application/movement/index.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import {
  createMovementPlan,
  MovementError,
  type MovementCommand,
} from "../src/domain/movement/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import type { StateCommand } from "../src/domain/state/index.js";
import { FakeMovementPort } from "./fakes/fake-movement-port.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const pendingWait = (_delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

const command = (
  overrides: Partial<MovementCommand> = {},
): MovementCommand => ({
  taskId: "move-1",
  taskType: "movement",
  target: { x: 2, y: 71, z: 0, dimension: "overworld" },
  limits: {
    maxStepDistance: 1,
    maxSteps: 10,
    stepTimeoutMs: 5_000,
    arrivalTolerance: 0.01,
  },
  ...overrides,
});

const setup = async (port = new FakeMovementPort()) => {
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
    instruction: {
      taskId: "move-1",
      taskType: "movement",
      priority: 1,
      maxAttempts: 2,
    },
  });
  await queue.dispatch({ type: "task.claim_next" });
  const coordinator = new MovementCoordinator({
    port,
    stateStore: state,
    safetyPolicy: new DefaultWorkSafetyPolicy(),
    taskQueue: queue,
    wait: pendingWait,
  });
  return { coordinator, port, queue, repository, state };
};

describe("movement plan", () => {
  it("有限stepを直線上に順序付けて生成する", () => {
    const plan = createMovementPlan(
      { x: 0, y: 71, z: 0, dimension: "overworld" },
      { x: 2.5, y: 71, z: 0, dimension: "overworld" },
      command().limits,
    );
    expect(plan.steps.map(({ index }) => index)).toEqual([1, 2, 3]);
    expect(plan.steps[0]?.target.x).toBeCloseTo(2.5 / 3);
    expect(plan.steps[1]?.target.x).toBeCloseTo(5 / 3);
    expect(plan.steps[2]?.target.x).toBe(2.5);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.steps)).toBe(true);
  });

  it.each([
    { x: Number.NaN, y: 71, z: 0, dimension: "overworld" as const },
    { x: 30_000_001, y: 71, z: 0, dimension: "overworld" as const },
    { x: 0, y: -65, z: 0, dimension: "overworld" as const },
    { x: 0, y: 321, z: 0, dimension: "overworld" as const },
  ])("不正または範囲外座標を拒否する: $x/$y", (target) => {
    expect(() =>
      createMovementPlan(
        { x: 0, y: 71, z: 0, dimension: "overworld" },
        target,
        command().limits,
      ),
    ).toThrowError(MovementError);
  });

  it("異dimensionと最大step超過を拒否する", () => {
    expect(() =>
      createMovementPlan(
        { x: 0, y: 71, z: 0, dimension: "overworld" },
        { x: 0, y: 71, z: 0, dimension: "nether" },
        command().limits,
      ),
    ).toThrowError(MovementError);
    expect(() =>
      createMovementPlan(
        { x: 0, y: 71, z: 0, dimension: "overworld" },
        { x: 11, y: 71, z: 0, dimension: "overworld" },
        command().limits,
      ),
    ).toThrowError(MovementError);
  });

  it("無効なstep距離、timeout、到達許容差を拒否する", () => {
    for (const limits of [
      { ...command().limits, maxStepDistance: 0 },
      { ...command().limits, stepTimeoutMs: 0 },
      { ...command().limits, arrivalTolerance: 2 },
    ]) {
      expect(() =>
        createMovementPlan(
          { x: 0, y: 71, z: 0, dimension: "overworld" },
          { x: 1, y: 71, z: 0, dimension: "overworld" },
          limits,
        ),
      ).toThrowError(MovementError);
    }
  });
});

describe("MovementCoordinator", () => {
  it("各stepを順に送り、進捗とqueueを一度だけcompletedへ終端化する", async () => {
    const { coordinator, port, repository, state } = await setup();
    const result = await coordinator.execute(command());
    expect(result).toMatchObject({ outcome: "completed", stepsCompleted: 2 });
    expect(port.steps.map(({ index }) => index)).toEqual([1, 2]);
    expect(state.getSnapshot().task).toMatchObject({
      state: "completed",
      progress: 1,
    });
    expect(await repository.find("move-1")).toMatchObject({
      status: "completed",
    });
  });

  it("step timeoutで中断し、再試行せずfailedにする", async () => {
    const port = new FakeMovementPort(
      (_step, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort")), {
            once: true,
          }),
        ),
    );
    const context = await setup(port);
    const coordinator = new MovementCoordinator({
      port,
      stateStore: context.state,
      safetyPolicy: new DefaultWorkSafetyPolicy(),
      taskQueue: context.queue,
      wait: () => Promise.resolve(),
    });
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "step_timeout",
      stepsCompleted: 0,
    });
    expect(port.steps).toHaveLength(1);
    expect(port.stopCalls).toBe(1);
  });

  it("port failureで中断し、後続stepを送らない", async () => {
    const port = new FakeMovementPort(() => {
      throw new Error("unsafe raw failure");
    });
    const { coordinator } = await setup(port);
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "movement_port_error",
    });
    expect(port.steps).toHaveLength(1);
  });

  it("claimedでないtaskやtask type不一致ではportを呼ばない", async () => {
    const queued = await setup();
    await queued.queue.dispatch({ type: "task.release", taskId: "move-1" });
    expect(await queued.coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "task_not_claimed",
    });
    expect(queued.port.steps).toHaveLength(0);

    await queued.queue.dispatch({ type: "task.claim_next" });
    expect(
      await queued.coordinator.execute(command({ taskType: "different" })),
    ).toMatchObject({ outcome: "failed", reason: "task_not_claimed" });
    expect(queued.port.steps).toHaveLength(0);
  });

  it("StateStoreで別taskが実行中なら移動せず、そのtaskを変更しない", async () => {
    const base = await setup();
    base.state.dispatch({
      type: "task.prepare",
      taskId: "other-task",
      taskType: "verification",
    });
    base.state.dispatch({ type: "task.transition", to: "running" });
    expect(await base.coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "task_state_conflict",
    });
    expect(base.port.steps).toHaveLength(0);
    expect(base.state.getSnapshot().task).toMatchObject({
      id: "other-task",
      state: "running",
    });
    expect(await base.repository.find("move-1")).toMatchObject({
      status: "claimed",
    });
  });

  it("観測位置が目標へ到達しない場合はfailedにする", async () => {
    const port = new FakeMovementPort((step) => ({
      ...step.target,
      x: step.target.x - 0.5,
    }));
    const { coordinator } = await setup(port);
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "target_not_reached",
      stepsCompleted: 0,
    });
    expect(port.steps).toHaveLength(1);
    expect(port.stopCalls).toBe(1);
  });

  it("step応答が別dimensionなら即停止し後続stepを送らない", async () => {
    const port = new FakeMovementPort((step) => ({
      ...step.target,
      dimension: "nether",
    }));
    const { coordinator } = await setup(port);
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "target_not_reached",
      stepsCompleted: 0,
    });
    expect(port.steps).toHaveLength(1);
  });

  it("完了結果には許容差内の観測位置を返す", async () => {
    const port = new FakeMovementPort((step) => ({
      ...step.target,
      x: step.index === step.total ? step.target.x - 0.005 : step.target.x,
    }));
    const { coordinator } = await setup(port);
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "completed",
      finalPosition: { x: 1.995, y: 71, z: 0, dimension: "overworld" },
    });
  });

  it("cancelで進行中stepを止め、listenerを解除して一度だけstopする", async () => {
    const port = new FakeMovementPort(
      (_step, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort")), {
            once: true,
          }),
        ),
    );
    const { coordinator, repository } = await setup(port);
    const running = coordinator.execute(command());
    await Promise.resolve();
    await Promise.resolve();
    coordinator.cancel();
    coordinator.cancel();
    expect(await running).toMatchObject({
      outcome: "stopped",
      reason: "cancelled",
    });
    expect(port.stopCalls).toBe(1);
    expect(await repository.find("move-1")).toMatchObject({
      status: "stopped",
    });
  });

  it("送信microtask前のcancelではportを呼ばない", async () => {
    const { coordinator, port } = await setup();
    const running = coordinator.execute(command());
    coordinator.cancel();
    expect(await running).toMatchObject({
      outcome: "stopped",
      reason: "cancelled",
      stepsCompleted: 0,
    });
    expect(port.steps).toHaveLength(0);
    expect(port.stopCalls).toBe(1);
  });

  it("step応答直後のcancelをcompletedとして扱わない", async () => {
    let resolveMove!: (position: MovementCommand["target"]) => void;
    const port = new FakeMovementPort(
      () =>
        new Promise((resolve) => {
          resolveMove = resolve;
        }),
    );
    const { coordinator } = await setup(port);
    const running = coordinator.execute(
      command({
        target: { x: 1, y: 71, z: 0, dimension: "overworld" },
      }),
    );
    for (
      let attempt = 0;
      attempt < 5 && port.steps.length === 0;
      attempt += 1
    ) {
      await Promise.resolve();
    }
    expect(port.steps).toHaveLength(1);
    resolveMove(port.steps[0]!.target);
    coordinator.cancel();
    expect(await running).toMatchObject({
      outcome: "stopped",
      reason: "cancelled",
    });
  });

  it("途中の他player検知をstep後に再評価し、以後送信しない", async () => {
    const base = await setup();
    const port = new FakeMovementPort((step) => {
      base.state.dispatch({ type: "safety.other_player_detected" });
      return step.target;
    });
    const coordinator = new MovementCoordinator({
      port,
      stateStore: base.state,
      safetyPolicy: new DefaultWorkSafetyPolicy(),
      taskQueue: base.queue,
      wait: pendingWait,
    });
    expect(await coordinator.execute(command())).toMatchObject({
      outcome: "stopped",
      reason: "safety_stop",
      stepsCompleted: 1,
    });
    expect(port.steps).toHaveLength(1);
    expect(port.stopCalls).toBe(1);
  });

  it.each([
    [
      "signal",
      () => ({ type: "runtime.stop_reason.record", reason: "signal_sigterm" }),
    ],
    [
      "health",
      () => ({ type: "minecraft.telemetry.update", telemetry: { health: 5 } }),
    ],
    [
      "hunger",
      () => ({ type: "minecraft.telemetry.update", telemetry: { hunger: 2 } }),
    ],
    ["invalid", () => ({ type: "minecraft.telemetry.invalidate" })],
  ] satisfies readonly (readonly [string, () => StateCommand])[])(
    "途中の%s安全状態変化で停止する",
    async (_name, next) => {
      const base = await setup();
      const port = new FakeMovementPort((step) => {
        base.state.dispatch(next());
        return step.target;
      });
      const coordinator = new MovementCoordinator({
        port,
        stateStore: base.state,
        safetyPolicy: new DefaultWorkSafetyPolicy(),
        taskQueue: base.queue,
        wait: pendingWait,
      });
      expect(await coordinator.execute(command())).toMatchObject({
        outcome: "stopped",
        reason: "safety_stop",
      });
      expect(port.steps).toHaveLength(1);
    },
  );

  it("安全telemetryが不足する場合は開始せずqueueを停止する", async () => {
    const base = await setup();
    base.state.dispatch({ type: "minecraft.telemetry.invalidate" });
    expect(await base.coordinator.execute(command())).toMatchObject({
      outcome: "stopped",
      reason: "safety_stop",
      stepsCompleted: 0,
    });
    expect(base.port.steps).toHaveLength(0);
    expect(await base.repository.find("move-1")).toMatchObject({
      status: "stopped",
    });
  });

  it("queue終端化失敗を分類し、StateStoreはfailedへ終端化する", async () => {
    const base = await setup(
      new FakeMovementPort(() => {
        throw new Error("port failure");
      }),
    );
    base.repository.replaceError = new Error("repository failure");
    expect(await base.coordinator.execute(command())).toMatchObject({
      outcome: "failed",
      reason: "finalization_error",
    });
    expect(base.state.getSnapshot().task.state).toBe("failed");
    expect(await base.repository.find("move-1")).toMatchObject({
      status: "claimed",
    });
  });

  it("同時に重複開始しない", async () => {
    const port = new FakeMovementPort(
      (_step, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("abort")), {
            once: true,
          }),
        ),
    );
    const { coordinator } = await setup(port);
    const active = coordinator.execute(command());
    await expect(coordinator.execute(command())).rejects.toMatchObject({
      code: "MOVEMENT_ALREADY_ACTIVE",
    });
    coordinator.cancel();
    await active;
  });
});
