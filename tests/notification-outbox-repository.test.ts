import { describe, expect, it } from "vitest";

import { InMemoryNotificationOutboxRepository } from "../src/adapters/persistence/in-memory-notification-outbox-repository.js";
import type { NotificationOutboxRecord } from "../src/ports/notification-outbox-repository.js";

const pending = (
  notificationId: string,
  revision: number,
  occurredAt: string,
): NotificationOutboxRecord => ({
  runId: "00000000-0000-4000-8000-000000000001",
  notificationId,
  message: {
    notificationId,
    sourceRevision: revision,
    type: "task_started",
    severity: "info",
    occurredAt,
    title: "fixture",
    body: "fixture",
  },
  status: "pending",
  attempts: 0,
});

describe("InMemoryNotificationOutboxRepository", () => {
  it("occurredAtとrevisionの安定順で排他的にclaimする", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      pending("later", 1, "2026-08-01T00:00:01.000Z"),
      pending("second", 2, "2026-08-01T00:00:00.000Z"),
      pending("first", 1, "2026-08-01T00:00:00.000Z"),
    ]);
    const first = await repository.claimNext(
      "worker-a",
      "2026-08-01T00:01:00.000Z",
      30_000,
      5,
    );
    const blocked = await repository.claimNext(
      "worker-b",
      "2026-08-01T00:01:00.000Z",
      30_000,
      5,
    );
    expect(first).toMatchObject({ notificationId: "first", attempts: 1 });
    expect(blocked).toBeUndefined();
    if (first === undefined) throw new Error();
    await repository.markDelivered(
      first,
      "worker-a",
      "2026-08-01T00:01:00.001Z",
    );
    const second = await repository.claimNext(
      "worker-b",
      "2026-08-01T00:01:00.002Z",
      30_000,
      5,
    );
    expect(second).toMatchObject({ notificationId: "second", attempts: 1 });
  });

  it("lease切れを回収し古いworkerの確定を拒否する", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      pending("leased", 1, "2026-08-01T00:00:00.000Z"),
    ]);
    const first = await repository.claimNext(
      "worker-a",
      "2026-08-01T00:00:00.000Z",
      1_000,
      5,
    );
    const reclaimed = await repository.claimNext(
      "worker-b",
      "2026-08-01T00:00:01.000Z",
      1_000,
      5,
    );
    if (first === undefined || reclaimed === undefined) throw new Error();
    expect(reclaimed.attempts).toBe(2);
    await expect(
      repository.markDelivered(first, "worker-a", "2026-08-01T00:00:01.000Z"),
    ).resolves.toBe(false);
    await expect(
      repository.markDelivered(
        reclaimed,
        "worker-b",
        "2026-08-01T00:00:01.000Z",
      ),
    ).resolves.toBe(true);
  });

  it("失敗を再試行しmax attemptsで終端化する", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      pending("bounded", 1, "2026-08-01T00:00:00.000Z"),
    ]);
    const first = await repository.claimNext(
      "worker",
      "2026-08-01T00:00:00.000Z",
      1_000,
      2,
    );
    if (first === undefined) throw new Error();
    await expect(
      repository.markFailed(
        first,
        "worker",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:01.000Z",
        "DELIVERY_TRANSIENT",
      ),
    ).resolves.toBe("pending");
    const second = await repository.claimNext(
      "worker",
      "2026-08-01T00:00:01.000Z",
      1_000,
      2,
    );
    if (second === undefined) throw new Error();
    await expect(
      repository.markFailed(
        second,
        "worker",
        "2026-08-01T00:00:01.000Z",
        undefined,
        "DELIVERY_FAILED",
      ),
    ).resolves.toBe("failed");
    await expect(
      repository.claimNext("worker", "2026-08-01T00:00:10.000Z", 1_000, 2),
    ).resolves.toBeUndefined();
  });

  it("先頭がretry待ちの間は後続通知を追い越さない", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      {
        ...pending("first", 1, "2026-08-01T00:00:00.000Z"),
        nextAttemptAt: "2026-08-01T00:01:00.000Z",
      },
      pending("second", 2, "2026-08-01T00:00:01.000Z"),
    ]);
    await expect(
      repository.claimNext("worker", "2026-08-01T00:00:30.000Z", 1_000, 5),
    ).resolves.toBeUndefined();
  });
});
