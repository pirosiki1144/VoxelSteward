import { describe, expect, it } from "vitest";

import {
  auditTaskRecovery,
  TaskRecoveryAuditError,
  TaskQueueService,
} from "../src/application/task-queue/index.js";
import { FakeTaskQueueRepository } from "./fakes/fake-task-queue-repository.js";

const enqueue = (service: TaskQueueService, taskId: string, priority: number) =>
  service.dispatch({
    type: "task.enqueue",
    instruction: {
      taskId,
      taskType: "verification",
      priority,
      maxAttempts: 1,
    },
  });

describe("auditTaskRecovery", () => {
  it("queued、claimed、終端済みを再起動時の安全な区分へ集計する", async () => {
    const repository = new FakeTaskQueueRepository();
    const service = new TaskQueueService(repository);
    await enqueue(service, "terminal", 30);
    await enqueue(service, "manual-review", 20);
    await enqueue(service, "claimable", 10);
    await service.dispatch({ type: "task.claim_next" });
    await service.dispatch({
      type: "task.finish",
      taskId: "terminal",
      outcome: "completed",
    });
    await service.dispatch({ type: "task.claim_next" });

    const audit = await auditTaskRecovery(repository);

    expect(audit).toEqual({ claimable: 1, manualReview: 1, terminal: 1 });
    expect(Object.isFrozen(audit)).toBe(true);
    expect((await repository.find("terminal"))?.status).toBe("completed");
    expect((await repository.find("manual-review"))?.status).toBe("claimed");
  });

  it("Repository障害を秘密を含まない固定errorへ変換する", async () => {
    const repository = new FakeTaskQueueRepository();
    await repository.close();

    await expect(auditTaskRecovery(repository)).rejects.toEqual(
      new TaskRecoveryAuditError(),
    );
  });
});
