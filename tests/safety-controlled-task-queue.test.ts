import { describe, expect, it } from "vitest";

import { SafetyControlledTaskQueue } from "../src/application/safety/index.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const setup = () => {
  const repository = new FakeTaskQueueRepository();
  const queue = new TaskQueueService(repository);
  const state = createStateStore();
  const safety = new SafetyControlledTaskQueue(
    queue,
    state,
    new DefaultWorkSafetyPolicy(),
  );
  return { repository, queue, state, safety };
};

const enqueue = (queue: TaskQueueService, taskId = "safe-task") =>
  queue.dispatch({
    type: "task.enqueue",
    instruction: {
      taskId,
      taskType: "verification",
      priority: 1,
      maxAttempts: 2,
    },
  });

const makeReady = (state: ReturnType<typeof createStateStore>): void => {
  state.dispatch({ type: "runtime.transition", to: "connecting" });
  state.dispatch({ type: "minecraft.connection.transition", to: "connecting" });
  state.dispatch({ type: "minecraft.connection.transition", to: "connected" });
  state.dispatch({ type: "minecraft.spawn.update", completed: true });
  state.dispatch({
    type: "minecraft.telemetry.update",
    telemetry: { health: 20, hunger: 20 },
  });
  state.dispatch({ type: "runtime.transition", to: "ready" });
};

describe("SafetyControlledTaskQueue", () => {
  it("安全条件が揃うまでqueueをclaimしない", async () => {
    const { queue, repository, safety } = setup();
    await enqueue(queue);
    const result = await safety.claimNext();
    expect(result.decision).toMatchObject({
      disposition: "block",
      reason: "runtime_not_ready",
    });
    expect((await repository.find("safe-task"))?.status).toBe("queued");
  });

  it("runtimeとtelemetryが安全な場合だけtaskをclaimする", async () => {
    const { queue, state, safety } = setup();
    await enqueue(queue);
    makeReady(state);
    const result = await safety.claimNext();
    expect(result.decision.disposition).toBe("allow");
    expect(result.item).toMatchObject({
      taskId: "safe-task",
      status: "claimed",
    });
  });

  it("安全評価とclaimの間に停止した場合はclaimed taskを即時停止して返さない", async () => {
    const { queue, repository, state } = setup();
    await enqueue(queue, "race-task");
    makeReady(state);
    let reads = 0;
    const snapshots = {
      getSnapshot: () => {
        reads += 1;
        if (reads === 2)
          state.dispatch({ type: "safety.other_player_detected" });
        return state.getSnapshot();
      },
    };
    const safety = new SafetyControlledTaskQueue(
      queue,
      snapshots,
      new DefaultWorkSafetyPolicy(),
    );

    const result = await safety.claimNext();

    expect(result.item).toBeUndefined();
    expect(result.decision).toMatchObject({
      disposition: "block",
      reason: "other_player_detected",
      resumable: false,
    });
    expect((await repository.find("race-task"))?.status).toBe("stopped");
  });

  it("他プレイヤー検知後は再claimせずclaimed taskを一度だけ停止する", async () => {
    const { queue, repository, state, safety } = setup();
    await enqueue(queue);
    makeReady(state);
    await safety.claimNext();
    state.dispatch({ type: "safety.other_player_detected" });

    const first = await safety.enforceContinuation("safe-task");
    const duplicate = await safety.enforceContinuation("safe-task");
    expect(first).toMatchObject({
      stopped: true,
      decision: { reason: "other_player_detected", resumable: false },
    });
    expect(duplicate.stopped).toBe(false);
    expect((await repository.find("safe-task"))?.status).toBe("stopped");
    expect((await safety.claimNext()).decision).toMatchObject({
      disposition: "block",
      reason: "other_player_detected",
      resumable: false,
    });
  });

  it("signal停止時も継続中taskを停止し再claimしない", async () => {
    const { queue, repository, state, safety } = setup();
    await enqueue(queue, "signal-task");
    makeReady(state);
    await safety.claimNext();
    state.dispatch({
      type: "runtime.stop_reason.record",
      reason: "signal_sigterm",
    });
    state.dispatch({ type: "runtime.transition", to: "stopping" });

    expect(await safety.enforceContinuation("signal-task")).toMatchObject({
      stopped: true,
      decision: { reason: "stop_requested", resumable: false },
    });
    expect((await repository.find("signal-task"))?.status).toBe("stopped");
  });
});
