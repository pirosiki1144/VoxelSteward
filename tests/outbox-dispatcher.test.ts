import { describe, expect, it, vi } from "vitest";

import { InMemoryNotificationOutboxRepository } from "../src/adapters/persistence/in-memory-notification-outbox-repository.js";
import { OutboxDispatcher } from "../src/application/notifications/index.js";
import type { NotificationOutboxRecord } from "../src/ports/notification-outbox-repository.js";
import { FakeNotificationPort } from "./fakes/fake-notification-port.js";

const pending = (
  notificationId: string,
  revision: number,
): NotificationOutboxRecord => ({
  runId: "00000000-0000-4000-8000-000000000001",
  notificationId,
  message: {
    notificationId,
    sourceRevision: revision,
    type: "task_started",
    severity: "info",
    occurredAt: `2026-08-01T00:00:0${revision}.000Z`,
    title: "fixture",
    body: "fixture",
  },
  status: "pending",
  attempts: 0,
});

describe("OutboxDispatcher", () => {
  it("永続outboxをrevision順に配送してdeliveredへ確定する", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      pending("second", 2),
      pending("first", 1),
    ]);
    const port = new FakeNotificationPort();
    const dispatcher = new OutboxDispatcher(repository, port, {
      workerId: "worker-a",
      now: () => new Date("2026-08-01T00:01:00.000Z"),
    });

    await expect(dispatcher.dispatchAvailable()).resolves.toBe(2);
    expect(port.messages.map(({ notificationId }) => notificationId)).toEqual([
      "first",
      "second",
    ]);
    expect(repository.list().map(({ status }) => status)).toEqual([
      "delivered",
      "delivered",
    ]);
  });

  it("複数workerが同じnotificationを重複配送しない", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = new InMemoryNotificationOutboxRepository([
      pending("once", 1),
    ]);
    const firstPort = new FakeNotificationPort(() => blocked);
    const secondPort = new FakeNotificationPort();
    const first = new OutboxDispatcher(repository, firstPort, {
      workerId: "worker-a",
      now: () => new Date("2026-08-01T00:01:00.000Z"),
    });
    const second = new OutboxDispatcher(repository, secondPort, {
      workerId: "worker-b",
      now: () => new Date("2026-08-01T00:01:00.000Z"),
    });

    const delivery = first.dispatchAvailable();
    await Promise.resolve();
    await expect(second.dispatchAvailable()).resolves.toBe(0);
    release();
    await expect(delivery).resolves.toBe(1);
    expect(firstPort.messages).toHaveLength(1);
    expect(secondPort.messages).toHaveLength(0);
  });

  it("一時失敗を永続backoff後に再試行し安全なerror codeだけを保存する", async () => {
    let current = new Date("2026-08-01T00:00:00.000Z");
    let calls = 0;
    const repository = new InMemoryNotificationOutboxRepository([
      pending("retry", 1),
    ]);
    const port = new FakeNotificationPort(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("sensitive transport detail"))
        : Promise.resolve();
    });
    const dispatcher = new OutboxDispatcher(repository, port, {
      workerId: "worker",
      now: () => current,
      retryBaseDelayMs: 1_000,
      toSafeErrorCode: () => "TRANSPORT_TRANSIENT",
    });

    await expect(dispatcher.dispatchAvailable()).resolves.toBe(0);
    expect(repository.list()[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastErrorCode: "TRANSPORT_TRANSIENT",
      nextAttemptAt: "2026-08-01T00:00:01.000Z",
    });
    expect(JSON.stringify(repository.list())).not.toContain("sensitive");
    current = new Date("2026-08-01T00:00:01.000Z");
    await expect(dispatcher.dispatchAvailable()).resolves.toBe(1);
    expect(repository.list()[0]).toMatchObject({
      status: "delivered",
      attempts: 2,
    });
  });

  it("先頭配送の失敗時に後続revisionを追い越さない", async () => {
    const repository = new InMemoryNotificationOutboxRepository([
      pending("first", 1),
      pending("second", 2),
    ]);
    const port = new FakeNotificationPort(() =>
      Promise.reject(new Error("unavailable")),
    );
    const dispatcher = new OutboxDispatcher(repository, port, {
      workerId: "worker",
      now: () => new Date("2026-08-01T00:01:00.000Z"),
    });

    await expect(dispatcher.dispatchAvailable()).resolves.toBe(0);
    expect(port.messages.map(({ notificationId }) => notificationId)).toEqual([
      "first",
    ]);
    expect(
      repository
        .list()
        .find(({ notificationId }) => notificationId === "second"),
    ).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("最大試行回数でfailedへ終端化して後続claimを止める", async () => {
    let current = new Date("2026-08-01T00:00:00.000Z");
    const repository = new InMemoryNotificationOutboxRepository([
      pending("terminal", 1),
    ]);
    const dispatcher = new OutboxDispatcher(
      repository,
      new FakeNotificationPort(() => Promise.reject(new Error("down"))),
      {
        workerId: "worker",
        maxAttempts: 2,
        now: () => current,
      },
    );

    await dispatcher.dispatchAvailable();
    current = new Date("2026-08-01T00:00:01.000Z");
    await dispatcher.dispatchAvailable();
    current = new Date("2026-08-01T00:01:00.000Z");
    await expect(dispatcher.dispatchAvailable()).resolves.toBe(0);
    expect(repository.list()[0]).toMatchObject({
      status: "failed",
      attempts: 2,
    });
  });

  it("停止要求後は進行中配送だけを完了し新規claimしない", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const repository = new InMemoryNotificationOutboxRepository([
      pending("in-flight", 1),
      pending("not-claimed", 2),
    ]);
    const port = new FakeNotificationPort(() => blocked);
    const dispatcher = new OutboxDispatcher(repository, port, {
      workerId: "worker",
      pollIntervalMs: 10_000,
      now: () => new Date("2026-08-01T00:01:00.000Z"),
    });
    dispatcher.start();
    await Promise.resolve();

    const stopping = dispatcher.stop();
    release();
    await stopping;
    expect(port.messages.map(({ notificationId }) => notificationId)).toEqual([
      "in-flight",
    ]);
    expect(
      repository
        .list()
        .find(({ notificationId }) => notificationId === "not-claimed"),
    ).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("idle停止時にpoll timerを解放する", async () => {
    vi.useFakeTimers();
    try {
      const dispatcher = new OutboxDispatcher(
        new InMemoryNotificationOutboxRepository(),
        new FakeNotificationPort(),
        { workerId: "worker" },
      );
      dispatcher.start();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(vi.getTimerCount()).toBe(1);
      await dispatcher.stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
