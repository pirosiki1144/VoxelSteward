import { describe, expect, it } from "vitest";

import { TaskQueueService } from "../src/application/task-queue/index.js";
import {
  TaskQueueError,
  type TaskQueueClock,
} from "../src/domain/task-queue/index.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const clock = (...values: readonly string[]): TaskQueueClock => {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]!);
};

const enqueue = (
  service: TaskQueueService,
  taskId: string,
  priority = 0,
  maxAttempts = 3,
) =>
  service.dispatch({
    type: "task.enqueue",
    instruction: { taskId, taskType: "verification", priority, maxAttempts },
  });

describe("TaskQueueService", () => {
  it("優先度が高い順、同優先度はFIFOでclaimする", async () => {
    const repository = new FakeTaskQueueRepository();
    const service = new TaskQueueService(
      repository,
      clock(
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:01.000Z",
        "2026-08-01T00:00:02.000Z",
        "2026-08-01T00:00:03.000Z",
        "2026-08-01T00:00:04.000Z",
      ),
    );
    await enqueue(service, "low", 1);
    await enqueue(service, "high-first", 10);
    await enqueue(service, "high-second", 10);
    expect(
      (await service.dispatch({ type: "task.claim_next" })).item?.taskId,
    ).toBe("high-first");
    expect(
      (await service.dispatch({ type: "task.claim_next" })).item?.taskId,
    ).toBe("high-second");
  });

  it("同じtaskIdのenqueueを冪等に扱う", async () => {
    const repository = new FakeTaskQueueRepository();
    const service = new TaskQueueService(repository);
    const first = await enqueue(service, "same", 3);
    const second = await enqueue(service, "same", 99);
    expect(second.item).toEqual(first.item);
    expect(await repository.list()).toHaveLength(1);
  });

  it("cancelはqueuedだけに許可し終端状態から戻さない", async () => {
    const repository = new FakeTaskQueueRepository();
    const service = new TaskQueueService(repository);
    await enqueue(service, "cancel-me");
    expect(
      (await service.dispatch({ type: "task.cancel", taskId: "cancel-me" }))
        .item?.status,
    ).toBe("cancelled");
    await expect(
      service.dispatch({ type: "task.cancel", taskId: "cancel-me" }),
    ).rejects.toMatchObject({ code: "INVALID_TASK_TRANSITION" });
  });

  it("releaseを有限回だけ再キューし上限到達でfailedにする", async () => {
    const repository = new FakeTaskQueueRepository();
    const service = new TaskQueueService(repository);
    await enqueue(service, "bounded", 0, 2);
    await service.dispatch({ type: "task.claim_next" });
    expect(
      (await service.dispatch({ type: "task.release", taskId: "bounded" })).item
        ?.status,
    ).toBe("queued");
    await service.dispatch({ type: "task.claim_next" });
    const exhausted = await service.dispatch({
      type: "task.release",
      taskId: "bounded",
    });
    expect(exhausted.item).toMatchObject({ status: "failed", attempts: 2 });
    expect(
      (await service.dispatch({ type: "task.claim_next" })).item,
    ).toBeUndefined();
  });

  it.each(["completed", "failed", "stopped"] as const)(
    "claimedを%sとして終端化する",
    async (outcome) => {
      const repository = new FakeTaskQueueRepository();
      const service = new TaskQueueService(repository);
      await enqueue(service, `finish-${outcome}`);
      await service.dispatch({ type: "task.claim_next" });
      expect(
        (
          await service.dispatch({
            type: "task.finish",
            taskId: `finish-${outcome}`,
            outcome,
          })
        ).item?.status,
      ).toBe(outcome);
    },
  );

  it("不正な指示を安全なdomain errorで拒否する", async () => {
    const service = new TaskQueueService(new FakeTaskQueueRepository());
    await expect(
      enqueue(service, "contains secret whitespace", -1, 0),
    ).rejects.toBeInstanceOf(TaskQueueError);
  });

  it("存在しないtaskの更新を拒否する", async () => {
    const service = new TaskQueueService(new FakeTaskQueueRepository());
    await expect(
      service.dispatch({ type: "task.release", taskId: "missing" }),
    ).rejects.toMatchObject({ code: "TASK_NOT_FOUND" });
  });

  it("snapshotとevent itemを実行時に変更できない", async () => {
    const service = new TaskQueueService(new FakeTaskQueueRepository());
    const event = await enqueue(service, "immutable");
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.item)).toBe(true);
    expect(() => {
      Object.assign(event.item!, { priority: 100 });
    }).toThrow(TypeError);
  });
});
