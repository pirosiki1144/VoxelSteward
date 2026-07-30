import { describe, expect, it, vi } from "vitest";

import {
  mapStateChangeToNotification,
  NotificationSubscriber,
  type NotificationMessage,
  type NotificationType,
} from "../src/application/notifications/index.js";
import {
  createStateStore,
  type Clock,
  type StateChangeEvent,
  type StateCommand,
  type StateStore,
} from "../src/domain/state/index.js";
import { FakeNotificationPort } from "./fakes/fake-notification-port.js";

class FakeClock implements Clock {
  #now = new Date("2026-07-30T00:00:00.000Z");

  now(): Date {
    return new Date(this.#now);
  }

  advance(): void {
    this.#now = new Date(this.#now.getTime() + 1_000);
  }
}

const dispatch = (
  store: StateStore,
  clock: FakeClock,
  command: StateCommand,
): StateChangeEvent => {
  clock.advance();
  const event = store.dispatch(command);
  if (event === undefined) throw new Error("expected a state change event");
  return event;
};

const setup = () => {
  const clock = new FakeClock();
  const store = createStateStore({ clock });
  return { clock, store };
};

const connect = (store: StateStore, clock: FakeClock): StateChangeEvent[] => [
  dispatch(store, clock, { type: "runtime.transition", to: "connecting" }),
  dispatch(store, clock, {
    type: "minecraft.connection.transition",
    to: "connecting",
  }),
  dispatch(store, clock, {
    type: "minecraft.connection.transition",
    to: "connected",
  }),
  dispatch(store, clock, {
    type: "minecraft.spawn.update",
    completed: true,
  }),
  dispatch(store, clock, { type: "runtime.transition", to: "ready" }),
];

const mapType = (event: StateChangeEvent): NotificationType | undefined =>
  mapStateChangeToNotification(event)?.type;

describe("notification mapper", () => {
  it("決定論的で実行時不変な通知を生成する", () => {
    const { clock, store } = setup();
    dispatch(store, clock, {
      type: "runtime.transition",
      to: "connecting",
    });
    const event = dispatch(store, clock, {
      type: "minecraft.connection.transition",
      to: "connecting",
    });

    const first = mapStateChangeToNotification(event);
    const second = mapStateChangeToNotification(event);

    expect(first).toEqual({
      notificationId: "state:2:minecraft_connecting",
      sourceRevision: 2,
      type: "minecraft_connecting",
      severity: "info",
      occurredAt: "2026-07-30T00:00:02.000Z",
      title: "Minecraftへ接続開始",
      body: "Minecraftへの読み取り専用接続を開始しました。",
    });
    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Reflect.set(first!, "title", "changed")).toBe(false);
  });

  it("接続開始、login、spawnを実際の接続状態から通知する", () => {
    const { clock, store } = setup();
    const events = connect(store, clock);
    expect(events.map(mapType)).toEqual([
      undefined,
      "minecraft_connecting",
      "minecraft_connected",
      "minecraft_spawned",
      undefined,
    ]);
  });

  it("一時切断と再接続開始を通知する", () => {
    const { clock, store } = setup();
    connect(store, clock);
    const disconnected = dispatch(store, clock, {
      type: "minecraft.connection.transition",
      to: "disconnected",
    });
    const reconnecting = dispatch(store, clock, {
      type: "runtime.transition",
      to: "reconnecting",
    });

    expect(mapType(disconnected)).toBe("minecraft_disconnected");
    expect(mapType(reconnecting)).toBe("reconnect_started");
  });

  it.each([["signal_sigint"], ["signal_sigterm"], ["stop_requested"]] as const)(
    "停止要求%sと正常停止を通知する",
    (reason) => {
      const { clock, store } = setup();
      const requestEvent = dispatch(store, clock, {
        type: "runtime.stop_reason.record",
        reason,
      });
      dispatch(store, clock, { type: "runtime.transition", to: "stopping" });
      const stopped = dispatch(store, clock, {
        type: "runtime.transition",
        to: "stopped",
      });

      expect(mapType(requestEvent)).toBe("stop_requested");
      expect(mapType(stopped)).toBe("runtime_stopped");
    },
  );

  it.each([
    ["connection_error", "runtime_failed"],
    ["internal_error", "runtime_failed"],
    ["reconnect_exhausted", "reconnect_exhausted"],
  ] as const)("サニタイズ済みエラー%sを%sへ変換する", (code, expected) => {
    const { clock, store } = setup();
    const event = dispatch(store, clock, {
      type: "runtime.error.record",
      error: { code, message: "safe but not forwarded" },
    });
    const message = mapStateChangeToNotification(event);

    expect(message?.type).toBe(expected);
    expect(message?.body).not.toContain("safe but not forwarded");
  });

  it("他プレイヤー検知を緊急停止1件へ変換し名前を含めない", () => {
    const { clock, store } = setup();
    connect(store, clock);
    const event = dispatch(store, clock, {
      type: "safety.other_player_detected",
    });
    const message = mapStateChangeToNotification(event);

    expect(message).toMatchObject({
      type: "other_player_safety_stop",
      severity: "critical",
    });
    expect(JSON.stringify(message)).not.toContain("playerName");
    expect(mapStateChangeToNotification(event)).toEqual(message);

    const stopped = dispatch(store, clock, {
      type: "runtime.transition",
      to: "stopped",
    });
    expect(mapStateChangeToNotification(stopped)).toBeUndefined();
  });

  it("作業の全対象遷移を通知する", () => {
    const { clock, store } = setup();
    const events = [
      dispatch(store, clock, {
        type: "task.prepare",
        taskId: "task-001",
        taskType: "future-task",
      }),
      dispatch(store, clock, { type: "task.transition", to: "running" }),
      dispatch(store, clock, { type: "task.transition", to: "paused" }),
      dispatch(store, clock, { type: "task.transition", to: "running" }),
      dispatch(store, clock, { type: "task.transition", to: "completed" }),
    ];
    expect(events.map(mapType)).toEqual([
      "task_preparing",
      "task_started",
      "task_paused",
      "task_resumed",
      "task_completed",
    ]);
  });

  it.each([
    ["failed", "task_failed"],
    ["stopped", "task_stopped"],
  ] as const)("作業終端%sを通知する", (state, expected) => {
    const { clock, store } = setup();
    dispatch(store, clock, {
      type: "task.prepare",
      taskId: "task-001",
      taskType: "future-task",
    });
    const event = dispatch(store, clock, {
      type: "task.transition",
      to: state,
    });
    expect(mapType(event)).toBe(expected);
  });

  it("telemetryと進捗メッセージを通知しない", () => {
    const { clock, store } = setup();
    const telemetry = dispatch(store, clock, {
      type: "minecraft.telemetry.update",
      telemetry: { position: { x: 1, y: 71, z: 2 }, health: 20, hunger: 18 },
    });
    dispatch(store, clock, {
      type: "task.prepare",
      taskId: "task-001",
      taskType: "future-task",
    });
    dispatch(store, clock, { type: "task.transition", to: "running" });
    const progress = dispatch(store, clock, {
      type: "task.progress.update",
      progress: 0.5,
      message: "free-form message must not be forwarded",
    });

    expect(mapStateChangeToNotification(telemetry)).toBeUndefined();
    expect(mapStateChangeToNotification(progress)).toBeUndefined();
  });
});

describe("NotificationSubscriber", () => {
  it("StateStoreからFake portへrevision順で配送する", async () => {
    const { clock, store } = setup();
    const port = new FakeNotificationPort();
    const subscriber = new NotificationSubscriber(port);
    subscriber.subscribe(store);

    connect(store, clock);
    await subscriber.flush();

    expect(port.messages.map(({ sourceRevision }) => sourceRevision)).toEqual([
      2, 3, 4,
    ]);
    expect(port.messages.map(({ type }) => type)).toEqual([
      "minecraft_connecting",
      "minecraft_connected",
      "minecraft_spawned",
    ]);
    subscriber.close();
  });

  it("重複revisionと古いrevisionを抑制する", async () => {
    const { clock, store } = setup();
    const port = new FakeNotificationPort();
    const subscriber = new NotificationSubscriber(port);
    dispatch(store, clock, {
      type: "runtime.transition",
      to: "connecting",
    });
    const current = dispatch(store, clock, {
      type: "minecraft.connection.transition",
      to: "connecting",
    });
    subscriber.accept(current);
    subscriber.accept(current);
    subscriber.accept({ ...current, revision: current.revision - 1 });
    await subscriber.flush();

    expect(port.messages).toHaveLength(1);
    expect(port.messages[0]?.notificationId).toBe(
      "state:2:minecraft_connecting",
    );
  });

  it("deduplication履歴を設定した上限に保つ", async () => {
    const port = new FakeNotificationPort();
    const subscriber = new NotificationSubscriber(port, {
      deduplicationCapacity: 2,
    });
    const { clock, store } = setup();
    const events = connect(store, clock).filter(
      (event) => mapStateChangeToNotification(event) !== undefined,
    );
    for (const event of events) subscriber.accept(event);
    await subscriber.flush();
    expect(port.messages).toHaveLength(3);
  });

  it.each(["sync", "async"] as const)(
    "%s送信失敗を隔離し後続通知を継続する",
    async (failureType) => {
      const errors: unknown[] = [];
      let calls = 0;
      const port = new FakeNotificationPort(() => {
        calls += 1;
        if (calls === 1) {
          if (failureType === "sync") throw new Error("sync send failed");
          return Promise.reject(new Error("async send failed"));
        }
        return Promise.resolve();
      });
      const subscriber = new NotificationSubscriber(port, {
        onNotificationError: (error) => errors.push(error),
      });
      const { clock, store } = setup();
      for (const event of connect(store, clock)) subscriber.accept(event);

      await expect(subscriber.flush()).resolves.toBeUndefined();
      expect(port.messages).toHaveLength(3);
      expect(errors).toHaveLength(1);
    },
  );

  it("状態dispatchを送信完了まで待たせない", async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = new FakeNotificationPort(() => pending);
    const subscriber = new NotificationSubscriber(port);
    const { clock, store } = setup();
    subscriber.subscribe(store);
    dispatch(store, clock, {
      type: "runtime.transition",
      to: "connecting",
    });
    const event = dispatch(store, clock, {
      type: "minecraft.connection.transition",
      to: "connecting",
    });

    expect(event.revision).toBe(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(port.messages).toHaveLength(1);
    release?.();
    await subscriber.flush();
    subscriber.close();
  });

  it("unsubscribeとclose後は通知せず、flushで未完了配送を解放する", async () => {
    const { clock, store } = setup();
    const port = new FakeNotificationPort();
    const subscriber = new NotificationSubscriber(port);
    const unsubscribe = subscriber.subscribe(store);
    unsubscribe();
    connect(store, clock);
    await subscriber.flush();
    expect(port.messages).toHaveLength(0);

    subscriber.close();
    const other = setup();
    const event = connect(other.store, other.clock)[1]!;
    subscriber.accept(event);
    await subscriber.flush();
    expect(port.messages).toHaveLength(0);
  });

  it("エラー報告callbackの例外を再帰させない", async () => {
    const port = new FakeNotificationPort(() =>
      Promise.reject(new Error("send failed")),
    );
    const reporter = vi.fn(() => {
      throw new Error("reporter failed");
    });
    const subscriber = new NotificationSubscriber(port, {
      onNotificationError: reporter,
    });
    const { clock, store } = setup();
    const event = connect(store, clock)[1]!;
    subscriber.accept(event);

    await expect(subscriber.flush()).resolves.toBeUndefined();
    expect(reporter).toHaveBeenCalledOnce();
  });

  it("通知型に秘密情報用フィールドを持たない", () => {
    const allowed: readonly (keyof NotificationMessage)[] = [
      "notificationId",
      "sourceRevision",
      "type",
      "severity",
      "occurredAt",
      "title",
      "body",
    ];
    expect(allowed).toHaveLength(7);
  });
});
