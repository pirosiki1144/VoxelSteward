import { describe, expect, it, vi } from "vitest";

import {
  createStateStore,
  InvalidStateCommandError,
  InvalidStateTransitionError,
  type Clock,
  type RuntimeState,
  type StateChangeEvent,
  type StateCommand,
  type StateSnapshot,
  type TaskState,
} from "../src/domain/state/index.js";

class FakeClock implements Clock {
  #current: Date;

  constructor(initial = "2026-07-30T00:00:00.000Z") {
    this.#current = new Date(initial);
  }

  now(): Date {
    return new Date(this.#current);
  }

  set(iso: string): void {
    this.#current = new Date(iso);
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const toReady = (
  dispatch: (command: StateCommand) => StateChangeEvent | undefined,
): void => {
  dispatch({ type: "runtime.transition", to: "connecting" });
  dispatch({
    type: "minecraft.connection.transition",
    to: "connecting",
  });
  dispatch({
    type: "minecraft.connection.transition",
    to: "connected",
  });
  dispatch({ type: "minecraft.spawn.update", completed: true });
  dispatch({ type: "runtime.transition", to: "ready" });
};

describe("InMemoryStateStore", () => {
  it("UTCの初期スナップショットを返す", () => {
    const store = createStateStore({ clock: new FakeClock() });

    expect(store.getSnapshot()).toEqual({
      revision: 0,
      updatedAt: "2026-07-30T00:00:00.000Z",
      runtime: "starting",
      minecraft: {
        connection: "disconnected",
        spawnCompleted: false,
        otherPlayerDetected: false,
      },
      task: {
        state: "idle",
        updatedAt: "2026-07-30T00:00:00.000Z",
      },
    });
  });

  it("Fake Clockを各変更dispatchで一度だけ使用する", () => {
    const clock = new FakeClock();
    const now = vi.spyOn(clock, "now");
    const store = createStateStore({ clock });
    expect(now).toHaveBeenCalledOnce();
    clock.set("2026-07-30T01:02:03.004Z");

    const event = store.dispatch({
      type: "runtime.transition",
      to: "connecting",
    });

    expect(now).toHaveBeenCalledTimes(2);
    expect(event?.occurredAt).toBe("2026-07-30T01:02:03.004Z");
    expect(event?.after.updatedAt).toBe("2026-07-30T01:02:03.004Z");
  });

  it.each([
    [
      [
        "starting",
        "connecting",
        "ready",
        "reconnecting",
        "connecting",
      ] satisfies readonly RuntimeState[],
    ],
    [
      [
        "starting",
        "connecting",
        "stopping",
        "stopped",
      ] satisfies readonly RuntimeState[],
    ],
    [["starting", "stopping", "stopped"] satisfies readonly RuntimeState[]],
    [["starting", "connecting", "failed"] satisfies readonly RuntimeState[]],
  ])("runtimeの有効遷移を受理する: %j", (states) => {
    const store = createStateStore({ clock: new FakeClock() });
    for (const to of states.slice(1)) {
      store.dispatch({ type: "runtime.transition", to });
    }
    expect(store.getSnapshot().runtime).toBe(states.at(-1));
  });

  it("runtimeの不正遷移で状態と通知を変更しない", async () => {
    const store = createStateStore({ clock: new FakeClock() });
    const listener = vi.fn();
    store.subscribe(listener);
    const before = store.getSnapshot();

    expect(() =>
      store.dispatch({ type: "runtime.transition", to: "ready" }),
    ).toThrow(InvalidStateTransitionError);
    await flushMicrotasks();

    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().revision).toBe(0);
    expect(listener).not.toHaveBeenCalled();
  });

  it.each([
    ["connecting", "ready"],
    ["connecting", "reconnecting"],
    ["connecting", "stopping"],
    ["connecting", "failed"],
    ["ready", "reconnecting"],
    ["ready", "stopping"],
    ["ready", "failed"],
    ["reconnecting", "connecting"],
    ["reconnecting", "stopping"],
    ["reconnecting", "failed"],
    ["stopping", "stopped"],
    ["stopping", "failed"],
  ] satisfies readonly (readonly [RuntimeState, RuntimeState])[])(
    "runtimeの許可辺 %s -> %s を受理する",
    (from, to) => {
      const store = createStateStore({ clock: new FakeClock() });
      const paths: Readonly<Record<RuntimeState, readonly RuntimeState[]>> = {
        starting: [],
        connecting: ["connecting"],
        ready: ["connecting", "ready"],
        reconnecting: ["connecting", "reconnecting"],
        stopping: ["stopping"],
        stopped: ["stopping", "stopped"],
        failed: ["connecting", "failed"],
      };
      for (const state of paths[from]) {
        store.dispatch({ type: "runtime.transition", to: state });
      }
      store.dispatch({ type: "runtime.transition", to });
      expect(store.getSnapshot().runtime).toBe(to);
    },
  );

  it.each([
    ["preparing", "running", "paused", "running", "completed"],
    ["preparing", "failed"],
    ["preparing", "stopped"],
  ] satisfies readonly (readonly TaskState[])[])(
    "作業の有効遷移と明示resetを扱う: %j",
    (...states) => {
      const clock = new FakeClock();
      const store = createStateStore({ clock });
      store.dispatch({
        type: "task.prepare",
        taskId: "task-001",
        taskType: "road-maintenance",
      });
      for (const to of states.slice(1)) {
        store.dispatch({
          type: "task.transition",
          to: to as Exclude<TaskState, "idle" | "preparing">,
        });
      }
      clock.set("2026-07-30T02:00:00.000Z");
      store.dispatch({ type: "task.reset" });
      expect(store.getSnapshot().task).toEqual({
        state: "idle",
        updatedAt: "2026-07-30T02:00:00.000Z",
      });
    },
  );

  it("作業の不正遷移と非終端resetを拒否する", () => {
    const store = createStateStore({ clock: new FakeClock() });
    expect(() =>
      store.dispatch({ type: "task.transition", to: "running" }),
    ).toThrow(InvalidStateTransitionError);
    expect(() => store.dispatch({ type: "task.reset" })).toThrow(
      InvalidStateTransitionError,
    );
    expect(store.getSnapshot().revision).toBe(0);
  });

  it.each([
    ["preparing", "running"],
    ["preparing", "failed"],
    ["preparing", "stopped"],
    ["running", "paused"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "stopped"],
    ["paused", "running"],
    ["paused", "failed"],
    ["paused", "stopped"],
  ] satisfies readonly (readonly [
    TaskState,
    Exclude<TaskState, "idle" | "preparing">,
  ])[])("作業の許可辺 %s -> %s を受理する", (from, to) => {
    const store = createStateStore({ clock: new FakeClock() });
    store.dispatch({
      type: "task.prepare",
      taskId: "task-001",
      taskType: "future-task",
    });
    if (from === "running" || from === "paused") {
      store.dispatch({ type: "task.transition", to: "running" });
    }
    if (from === "paused") {
      store.dispatch({ type: "task.transition", to: "paused" });
    }
    store.dispatch({ type: "task.transition", to });
    expect(store.getSnapshot().task.state).toBe(to);
  });

  it("telemetryを部分更新し同値更新を抑制する", () => {
    const store = createStateStore({ clock: new FakeClock() });
    const first = store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: { position: { x: 1, y: 71, z: 2 }, health: 20 },
    });
    const duplicate = store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: { position: { x: 1, y: 71, z: 2 }, health: 20 },
    });
    store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: { hunger: 18 },
    });

    expect(first?.changedFields).toEqual([
      "minecraft.position",
      "minecraft.health",
    ]);
    expect(duplicate).toBeUndefined();
    expect(store.getSnapshot().minecraft).toMatchObject({
      position: { x: 1, y: 71, z: 2 },
      health: 20,
      hunger: 18,
    });
    expect(store.getSnapshot().revision).toBe(2);
  });

  it("revision、イベント順序、beforeとafterを保持する", async () => {
    const store = createStateStore({ clock: new FakeClock() });
    const events: StateChangeEvent[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.dispatch({ type: "runtime.transition", to: "connecting" });
    store.dispatch({ type: "runtime.transition", to: "reconnecting" });
    await flushMicrotasks();

    expect(events.map(({ revision }) => revision)).toEqual([1, 2]);
    expect(events[0]?.before.runtime).toBe("starting");
    expect(events[0]?.after.runtime).toBe("connecting");
    expect(events[1]?.before).toBe(events[0]?.after);
  });

  it("複数subscriberへ配信しunsubscribe後は配信しない", async () => {
    const store = createStateStore({ clock: new FakeClock() });
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = store.subscribe(first);
    store.subscribe(second);

    store.dispatch({ type: "runtime.transition", to: "connecting" });
    unsubscribe();
    await flushMicrotasks();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("同期例外とasync rejectionを隔離して報告する", async () => {
    const errors: unknown[] = [];
    const store = createStateStore({
      clock: new FakeClock(),
      onSubscriberError: (error) => errors.push(error),
    });
    const healthy = vi.fn();
    store.subscribe(() => {
      throw new Error("sync subscriber failed");
    });
    store.subscribe(() => Promise.reject(new Error("async subscriber failed")));
    store.subscribe(healthy);

    expect(() =>
      store.dispatch({ type: "runtime.transition", to: "connecting" }),
    ).not.toThrow();
    await flushMicrotasks();

    expect(healthy).toHaveBeenCalledOnce();
    expect(errors).toHaveLength(2);
    expect(store.getSnapshot().runtime).toBe("connecting");
  });

  it("スナップショットとイベントを実行時にもdeep freezeする", () => {
    const store = createStateStore({ clock: new FakeClock() });
    const event = store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: { position: { x: 1, y: 2, z: 3 } },
    });
    const snapshot = store.getSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.minecraft)).toBe(true);
    expect(Object.isFrozen(snapshot.minecraft.position)).toBe(true);
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event?.before)).toBe(true);
    expect(Object.isFrozen(event?.after.minecraft.position)).toBe(true);
    expect(Reflect.set(snapshot.minecraft.position!, "x", 999)).toBe(false);
    expect(store.getSnapshot().minecraft.position?.x).toBe(1);
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY])(
    "範囲外の進捗値 %s を拒否する",
    (progress) => {
      const store = createStateStore({ clock: new FakeClock() });
      store.dispatch({
        type: "task.prepare",
        taskId: "task-001",
        taskType: "future-task",
      });
      store.dispatch({ type: "task.transition", to: "running" });
      const before = store.getSnapshot();

      expect(() =>
        store.dispatch({
          type: "task.progress.update",
          progress,
        }),
      ).toThrow(InvalidStateCommandError);
      expect(store.getSnapshot()).toBe(before);
    },
  );

  it.each([0, 1])("進捗境界値 %s を受理する", (progress) => {
    const store = createStateStore({ clock: new FakeClock() });
    store.dispatch({
      type: "task.prepare",
      taskId: "task-001",
      taskType: "future-task",
    });
    store.dispatch({ type: "task.transition", to: "running" });
    store.dispatch({ type: "task.progress.update", progress });
    expect(store.getSnapshot().task.progress).toBe(progress);
  });

  it("他プレイヤー検知を原子的に反映し復帰遷移を拒否する", () => {
    const store = createStateStore({ clock: new FakeClock() });
    toReady((command) => store.dispatch(command));
    const event = store.dispatch({
      type: "safety.other_player_detected",
    });

    expect(event?.changedFields).toEqual([
      "minecraft.otherPlayerDetected",
      "stopReason",
      "runtime",
    ]);
    expect(event?.after).toMatchObject({
      runtime: "stopping",
      stopReason: "other_player_detected",
      minecraft: { otherPlayerDetected: true },
    });
    expect(() =>
      store.dispatch({ type: "runtime.transition", to: "reconnecting" }),
    ).toThrow(InvalidStateTransitionError);
    store.dispatch({ type: "runtime.transition", to: "stopped" });
    expect(store.getSnapshot().runtime).toBe("stopped");
  });

  it("サニタイズ済みエラーだけを時刻付きで記録する", () => {
    const store = createStateStore({ clock: new FakeClock() });
    store.dispatch({
      type: "runtime.error.record",
      error: {
        code: "connection_error",
        message: "Minecraft connection failed",
      },
    });
    expect(store.getSnapshot().lastError).toEqual({
      code: "connection_error",
      message: "Minecraft connection failed",
      occurredAt: "2026-07-30T00:00:00.000Z",
    });
  });

  it("状態の公開形に識別情報や接続情報のフィールドを持たない", () => {
    const snapshot: StateSnapshot = createStateStore({
      clock: new FakeClock(),
    }).getSnapshot();
    const serialized = JSON.stringify(snapshot);
    for (const forbiddenKey of [
      "playerName",
      "accountName",
      "host",
      "port",
      "token",
      "cookie",
      "authCache",
    ]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
  });

  it("task開始・更新・終了時刻を同一dispatchのUTC時刻で記録する", () => {
    const clock = new FakeClock();
    const store = createStateStore({ clock });
    store.dispatch({
      type: "task.prepare",
      taskId: "task-001",
      taskType: "future-task",
    });
    clock.set("2026-07-30T01:00:00.000Z");
    store.dispatch({ type: "task.transition", to: "running" });
    clock.set("2026-07-30T02:00:00.000Z");
    store.dispatch({
      type: "task.progress.update",
      progress: 0.5,
      message: "halfway",
    });
    clock.set("2026-07-30T03:00:00.000Z");
    store.dispatch({ type: "task.transition", to: "completed" });

    expect(store.getSnapshot().task).toMatchObject({
      startedAt: "2026-07-30T01:00:00.000Z",
      updatedAt: "2026-07-30T03:00:00.000Z",
      finishedAt: "2026-07-30T03:00:00.000Z",
      progress: 0.5,
    });
  });

  it("全runtime遷移先が型付きで扱われる", () => {
    const states: readonly RuntimeState[] = [
      "starting",
      "connecting",
      "ready",
      "reconnecting",
      "stopping",
      "stopped",
      "failed",
    ];
    expect(states).toHaveLength(7);
  });
});
