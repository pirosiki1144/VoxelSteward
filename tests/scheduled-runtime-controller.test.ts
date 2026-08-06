import { describe, expect, it, vi } from "vitest";

import {
  ScheduledRuntimeController,
  type ScheduledRuntimeSession,
} from "../src/application/scheduling/index.js";
import {
  createWeekdayScheduler,
  type ScheduleIntent,
  type SchedulePhase,
  type SchedulerClock,
} from "../src/domain/scheduler/index.js";
import type { RuntimeResult, RuntimeStopReason } from "../src/runtime/types.js";

class FakeClock implements SchedulerClock {
  #current: Date;
  constructor(initial: string) {
    this.#current = new Date(initial);
  }
  now(): Date {
    return new Date(this.#current);
  }
  set(iso: string): void {
    this.#current = new Date(iso);
  }
}

class FakeSession implements ScheduledRuntimeSession {
  readonly intents: Array<{ intent: ScheduleIntent; phase: SchedulePhase }> =
    [];
  readonly stopReasons: RuntimeStopReason[] = [];
  closeCalls = 0;
  readonly #result: Promise<RuntimeResult>;
  #resolve!: (result: RuntimeResult) => void;

  constructor() {
    this.#result = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  recordScheduleIntent(intent: ScheduleIntent, phase: SchedulePhase): void {
    this.intents.push({ intent, phase });
  }
  run(): Promise<RuntimeResult> {
    return this.#result;
  }
  requestStop(reason: RuntimeStopReason): void {
    if (this.stopReasons.length !== 0) return;
    this.stopReasons.push(reason);
    this.#resolve({ reason, exitCode: reason === "internal_error" ? 1 : 0 });
  }
  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
  finish(result: RuntimeResult): void {
    this.#resolve(result);
  }
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ScheduledRuntimeController", () => {
  it("Fake Clockで午前・午後の境界を通し、読み取り専用sessionだけを順序実行する", async () => {
    const clock = new FakeClock("2026-08-04T23:59:00.000Z");
    const morning = new FakeSession();
    const afternoon = new FakeSession();
    const sessions = [morning, afternoon];
    const createSession = vi.fn(() => {
      const session = sessions.shift();
      if (session === undefined) throw new Error("unexpected session");
      return Promise.resolve(session);
    });
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
    });

    await controller.evaluateOnce();
    expect(createSession).not.toHaveBeenCalled();

    clock.set("2026-08-05T00:00:00.000Z");
    await controller.evaluateOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(morning.intents[0]?.intent.type).toBe("schedule.start_requested");

    clock.set("2026-08-05T02:59:00.000Z");
    await controller.evaluateOnce();
    expect(morning.stopReasons).toEqual(["schedule_window_ended"]);
    expect(morning.closeCalls).toBe(1);

    clock.set("2026-08-05T03:00:00.000Z");
    await controller.evaluateOnce();
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(afternoon.intents[0]?.intent.type).toBe("schedule.start_requested");

    clock.set("2026-08-05T08:00:00.000Z");
    await controller.evaluateOnce();
    expect(afternoon.stopReasons).toEqual(["schedule_window_ended"]);
    expect(afternoon.closeCalls).toBe(1);
    await controller.close();
  });

  it("枠開始時にsessionを一度だけ作成してschedule intentを記録する", async () => {
    const clock = new FakeClock("2026-08-06T00:00:00.000Z");
    const session = new FakeSession();
    const createSession = vi.fn().mockResolvedValue(session);
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
    });

    await controller.evaluateOnce();
    await controller.evaluateOnce();

    expect(createSession).toHaveBeenCalledOnce();
    expect(session.intents).toMatchObject([
      {
        phase: "morning",
        intent: {
          type: "schedule.start_requested",
          window: { id: "2026-08-06:morning" },
        },
      },
    ]);
    await controller.close();
  });

  it("旧runの停止とclose完了後に午後runを開始する", async () => {
    const clock = new FakeClock("2026-08-06T02:58:00.000Z");
    const morning = new FakeSession();
    const afternoon = new FakeSession();
    const order: string[] = [];
    morning.close = () => {
      order.push("morning.closed");
      morning.closeCalls += 1;
      return Promise.resolve();
    };
    const createSession = vi
      .fn()
      .mockImplementationOnce(() => {
        order.push("morning.created");
        return Promise.resolve(morning);
      })
      .mockImplementationOnce(() => {
        order.push("afternoon.created");
        return Promise.resolve(afternoon);
      });
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
    });
    await controller.evaluateOnce();
    clock.set("2026-08-06T03:00:00.000Z");
    await controller.evaluateOnce();

    expect(morning.stopReasons).toEqual(["schedule_window_ended"]);
    expect(order.indexOf("morning.closed")).toBeLessThan(
      order.indexOf("afternoon.created"),
    );
    expect(afternoon.intents[0]?.intent.type).toBe("schedule.start_requested");
    await controller.close();
  });

  it("他player停止後は同じ枠でsessionを再作成しない", async () => {
    const clock = new FakeClock("2026-08-06T01:00:00.000Z");
    const session = new FakeSession();
    const createSession = vi.fn().mockResolvedValue(session);
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
    });
    await controller.evaluateOnce();
    session.finish({ reason: "other_player_detected", exitCode: 0 });
    await flush();
    clock.set("2026-08-06T01:01:00.000Z");
    await controller.evaluateOnce();
    expect(createSession).toHaveBeenCalledOnce();
    await controller.close();
  });

  it("operator停止後は同じ枠で再接続しない", async () => {
    const clock = new FakeClock("2026-08-06T01:00:00.000Z");
    const session = new FakeSession();
    const createSession = vi.fn().mockResolvedValue(session);
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
    });
    await controller.evaluateOnce();
    controller.requestStop("stop_requested");
    await controller.close();
    expect(session.stopReasons).toEqual(["stop_requested"]);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it.each(["signal_sigint", "signal_sigterm"] as const)(
    "%sで待機とactive sessionを安全終了する",
    async (reason) => {
      const clock = new FakeClock("2026-08-06T01:00:00.000Z");
      const session = new FakeSession();
      const wait = vi.fn(
        (_delay: number, signal: AbortSignal) =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
      );
      const controller = new ScheduledRuntimeController({
        scheduler: createWeekdayScheduler(clock),
        createSession: () => Promise.resolve(session),
        wait,
      });
      const run = controller.run();
      await flush();
      controller.requestStop(reason);
      await expect(run).resolves.toBeUndefined();
      expect(session.stopReasons).toEqual([reason]);
      expect(session.closeCalls).toBe(1);
    },
  );

  it("session作成失敗を隔離し同じ枠で無制限再試行しない", async () => {
    const clock = new FakeClock("2026-08-06T01:00:00.000Z");
    const onEvent = vi.fn();
    const createSession = vi.fn().mockRejectedValue(new Error("unsafe"));
    const controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler(clock),
      createSession,
      onEvent,
    });
    await controller.evaluateOnce();
    clock.set("2026-08-06T01:01:00.000Z");
    await controller.evaluateOnce();
    expect(createSession).toHaveBeenCalledOnce();
    expect(onEvent).toHaveBeenCalledWith({
      type: "schedule.session_start_failed",
      windowId: "2026-08-06:morning",
    });
    await controller.close();
  });
});
