import { describe, expect, it, vi } from "vitest";

import { SafetyControlledTaskQueue } from "../src/application/safety/index.js";
import { ReadonlyTaskExecutor } from "../src/application/task-executor/index.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import {
  createStateStore,
  type StateStore,
} from "../src/domain/state/index.js";
import type { TaskInstruction } from "../src/domain/task-queue/index.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const readyStore = (): StateStore => {
  const store = createStateStore();
  store.dispatch({ type: "runtime.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connected" });
  store.dispatch({ type: "minecraft.spawn.update", completed: true });
  store.dispatch({ type: "runtime.transition", to: "ready" });
  store.dispatch({
    type: "minecraft.telemetry.update",
    telemetry: {
      position: { x: 1, y: 71, z: 2 },
      dimension: "overworld",
      health: 20,
      hunger: 20,
    },
  });
  return store;
};

const instruction = (
  kind: "verify_arrival" | "record_position",
): TaskInstruction => {
  const taskId = `${kind}-1`;
  return kind === "verify_arrival"
    ? {
        taskId,
        taskType: kind,
        priority: 10,
        maxAttempts: 1,
        details: {
          version: 1,
          kind,
          instruction: {
            taskId,
            taskType: kind,
            expected: { x: 1, y: 71, z: 2, dimension: "overworld" },
            tolerance: 0.1,
          },
        },
      }
    : {
        taskId,
        taskType: kind,
        priority: 10,
        maxAttempts: 1,
        details: {
          version: 1,
          kind,
          instruction: { taskId, taskType: kind },
        },
      };
};

const fixture = (store = readyStore()) => {
  const repository = new FakeTaskQueueRepository();
  const queue = new TaskQueueService(repository);
  const safeQueue = new SafetyControlledTaskQueue(
    queue,
    store,
    new DefaultWorkSafetyPolicy(),
  );
  const onError = vi.fn();
  const executor = new ReadonlyTaskExecutor({
    queue,
    safeQueue,
    stateStore: store,
    onError,
  });
  return { repository, queue, executor, store, onError };
};

describe("read-only task executor", () => {
  it.each(["verify_arrival", "record_position"] as const)(
    "%sをMinecraft送信なしで完了する",
    async (kind) => {
      const context = fixture();
      await context.queue.dispatch({
        type: "task.enqueue",
        instruction: instruction(kind),
      });
      expect(await context.executor.processNext()).toBe(true);
      expect((await context.queue.find(`${kind}-1`))?.status).toBe("completed");
      expect(context.store.getSnapshot().task.state).toBe("completed");
      expect(context.onError).not.toHaveBeenCalled();
      await context.executor.close();
    },
  );

  it("安全条件を満たさなければclaimしない", async () => {
    const store = createStateStore();
    const context = fixture(store);
    await context.queue.dispatch({
      type: "task.enqueue",
      instruction: instruction("record_position"),
    });
    expect(await context.executor.processNext()).toBe(false);
    expect((await context.queue.find("record_position-1"))?.status).toBe(
      "queued",
    );
    await context.executor.close();
  });

  it("他player検知後は実行中taskを停止する", async () => {
    const context = fixture();
    await context.queue.dispatch({
      type: "task.enqueue",
      instruction: instruction("record_position"),
    });
    context.store.dispatch({ type: "safety.other_player_detected" });
    expect(await context.executor.processNext()).toBe(false);
    expect((await context.queue.find("record_position-1"))?.status).toBe(
      "queued",
    );
    await context.executor.close();
  });

  it("SIGTERM相当の停止要求で実行中taskを一度だけ停止する", async () => {
    const store = readyStore();
    const repository = new FakeTaskQueueRepository();
    const queue = new TaskQueueService(repository);
    const safeQueue = new SafetyControlledTaskQueue(
      queue,
      store,
      new DefaultWorkSafetyPolicy(),
    );
    let finish: (() => void) | undefined;
    const coordinator = {
      execute: () =>
        new Promise<{
          readonly outcome: "completed";
          readonly taskType: "record_position";
          readonly position: {
            readonly x: number;
            readonly y: number;
            readonly z: number;
            readonly dimension: "overworld";
          };
        }>((resolve) => {
          finish = () =>
            resolve({
              outcome: "completed",
              taskType: "record_position",
              position: { x: 1, y: 71, z: 2, dimension: "overworld" },
            });
        }),
    };
    const executor = new ReadonlyTaskExecutor({
      queue,
      safeQueue,
      stateStore: store,
      coordinator,
    });
    await queue.dispatch({
      type: "task.enqueue",
      instruction: instruction("record_position"),
    });
    const running = executor.processNext();
    await vi.waitFor(() =>
      expect(store.getSnapshot().task.state).toBe("running"),
    );
    store.dispatch({
      type: "runtime.stop_reason.record",
      reason: "signal_sigterm",
    });
    store.dispatch({ type: "runtime.transition", to: "stopping" });
    finish?.();
    await running;
    expect((await queue.find("record_position-1"))?.status).toBe("stopped");
    expect(store.getSnapshot().task.state).toBe("stopped");
    await executor.close();
    await executor.close();
  });

  it("対象外taskをclaimしない", async () => {
    const context = fixture();
    await context.queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "legacy-1",
        taskType: "legacy",
        priority: 100,
        maxAttempts: 1,
      },
    });
    expect(await context.executor.processNext()).toBe(false);
    expect((await context.queue.find("legacy-1"))?.status).toBe("queued");
    await context.executor.close();
  });

  it("closeを複数回呼べる", async () => {
    const context = fixture();
    await context.executor.close();
    await context.executor.close();
    expect(await context.executor.processNext()).toBe(false);
  });

  it("DB claim障害をruntime状態へ再投入せず隔離する", async () => {
    const context = fixture();
    context.repository.claimError = new Error("database unavailable");
    context.executor.start();
    await vi.waitFor(() =>
      expect(context.onError).toHaveBeenCalledWith("TASK_EXECUTION_FAILED"),
    );
    expect(context.store.getSnapshot().runtime).toBe("ready");
    await context.executor.close();
  });
});
