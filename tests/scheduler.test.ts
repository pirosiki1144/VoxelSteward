import { describe, expect, it } from "vitest";

import {
  createWeekdayScheduler,
  evaluateWeekdayWindow,
  SchedulerError,
  SCHEDULER_TIME_ZONE,
  type SchedulerClock,
} from "../src/domain/scheduler/index.js";

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

describe("weekday scheduler", () => {
  it("JST境界を一箇所で判定し、時刻はUTCで返す", () => {
    expect(SCHEDULER_TIME_ZONE).toBe("Asia/Tokyo");
    expect(evaluateWeekdayWindow(new Date("2026-08-05T00:00:00.000Z"))).toEqual(
      {
        phase: "morning",
        window: {
          id: "2026-08-05:morning",
          slot: "morning",
          startsAt: "2026-08-05T00:00:00.000Z",
          endsAt: "2026-08-05T02:59:00.000Z",
        },
      },
    );
  });

  it.each([
    ["2026-08-04T23:59:59.999Z", "outside_hours"],
    ["2026-08-05T00:00:00.000Z", "morning"],
    ["2026-08-05T02:58:59.999Z", "morning"],
    ["2026-08-05T02:59:00.000Z", "handoff"],
    ["2026-08-05T03:00:00.000Z", "afternoon"],
    ["2026-08-05T07:59:59.999Z", "afternoon"],
    ["2026-08-05T08:00:00.000Z", "outside_hours"],
  ] as const)("%sを%sと判定する", (iso, phase) => {
    expect(evaluateWeekdayWindow(new Date(iso)).phase).toBe(phase);
  });

  it.each(["2026-08-01T01:00:00.000Z", "2026-08-02T04:00:00.000Z"])(
    "土日は運用時間外にする: %s",
    (iso) => {
      expect(evaluateWeekdayWindow(new Date(iso))).toEqual({
        phase: "outside_hours",
      });
    },
  );

  it("process再起動時に現在の午前枠を一度だけ開始する", () => {
    const scheduler = createWeekdayScheduler(
      new FakeClock("2026-08-05T01:00:00.000Z"),
    );
    expect(scheduler.evaluate()).toMatchObject({
      phase: "morning",
      evaluatedAt: "2026-08-05T01:00:00.000Z",
      intents: [
        {
          type: "schedule.start_requested",
          window: { id: "2026-08-05:morning" },
        },
      ],
    });
    expect(scheduler.evaluate().intents).toEqual([]);
  });

  it.each([
    ["2026-08-05T03:30:00.000Z", "afternoon", "2026-08-05:afternoon"],
    ["2026-08-05T08:30:00.000Z", "outside_hours", undefined],
  ] as const)(
    "process再起動時に現在の%s枠を正しく判定する",
    (iso, phase, windowId) => {
      const scheduler = createWeekdayScheduler(new FakeClock(iso));
      const evaluation = scheduler.evaluate();
      expect(evaluation.phase).toBe(phase);
      expect(evaluation.intents[0]?.window.id).toBe(windowId);
      expect(scheduler.evaluate().intents).toEqual([]);
    },
  );

  it("09:00に午前枠を一度だけ開始する", () => {
    const clock = new FakeClock("2026-08-04T23:59:59.999Z");
    const scheduler = createWeekdayScheduler(clock);
    expect(scheduler.evaluate().intents).toEqual([]);
    clock.set("2026-08-05T00:00:00.000Z");
    expect(scheduler.evaluate().intents).toMatchObject([
      {
        type: "schedule.start_requested",
        window: { id: "2026-08-05:morning" },
      },
    ]);
    expect(scheduler.evaluate().intents).toEqual([]);
  });

  it("11:59に午前枠を停止し、12:00に午後枠を開始する", () => {
    const clock = new FakeClock("2026-08-05T02:58:59.999Z");
    const scheduler = createWeekdayScheduler(clock);
    expect(scheduler.evaluate().intents[0]?.type).toBe(
      "schedule.start_requested",
    );

    clock.set("2026-08-05T02:59:00.000Z");
    expect(scheduler.evaluate()).toMatchObject({
      phase: "handoff",
      intents: [
        {
          type: "schedule.stop_requested",
          window: { id: "2026-08-05:morning" },
        },
      ],
    });
    expect(scheduler.evaluate().intents).toEqual([]);

    clock.set("2026-08-05T03:00:00.000Z");
    expect(scheduler.evaluate()).toMatchObject({
      phase: "afternoon",
      intents: [
        {
          type: "schedule.start_requested",
          window: { id: "2026-08-05:afternoon" },
        },
      ],
    });
  });

  it("17:00に午後枠を一度だけ停止する", () => {
    const clock = new FakeClock("2026-08-05T07:59:59.999Z");
    const scheduler = createWeekdayScheduler(clock);
    scheduler.evaluate();
    clock.set("2026-08-05T08:00:00.000Z");
    expect(scheduler.evaluate().intents).toMatchObject([
      {
        type: "schedule.stop_requested",
        window: { id: "2026-08-05:afternoon" },
      },
    ]);
    expect(scheduler.evaluate().intents).toEqual([]);
  });

  it("境界を飛越した場合は停止を先にし、現在枠の開始を一度だけ返す", () => {
    const clock = new FakeClock("2026-08-05T02:58:00.000Z");
    const scheduler = createWeekdayScheduler(clock);
    scheduler.evaluate();
    clock.set("2026-08-05T03:30:00.000Z");
    expect(scheduler.evaluate().intents.map(({ type }) => type)).toEqual([
      "schedule.stop_requested",
      "schedule.start_requested",
    ]);
    expect(scheduler.evaluate().intents).toEqual([]);
  });

  it("時計の巻戻りでは古い枠を再開始しない", () => {
    const clock = new FakeClock("2026-08-05T03:30:00.000Z");
    const scheduler = createWeekdayScheduler(clock);
    expect(scheduler.evaluate().intents).toHaveLength(1);
    clock.set("2026-08-05T01:00:00.000Z");
    expect(scheduler.evaluate()).toMatchObject({
      phase: "morning",
      intents: [],
    });
    clock.set("2026-08-05T03:31:00.000Z");
    expect(scheduler.evaluate().intents).toEqual([]);
  });

  it("翌営業日の同名枠を別windowとして停止後に開始する", () => {
    const clock = new FakeClock("2026-08-05T01:00:00.000Z");
    const scheduler = createWeekdayScheduler(clock);
    scheduler.evaluate();
    clock.set("2026-08-06T01:00:00.000Z");
    expect(scheduler.evaluate().intents).toMatchObject([
      {
        type: "schedule.stop_requested",
        window: { id: "2026-08-05:morning" },
      },
      {
        type: "schedule.start_requested",
        window: { id: "2026-08-06:morning" },
      },
    ]);
  });

  it("不正なClockを専用domain errorで拒否する", () => {
    const scheduler = createWeekdayScheduler({
      now: () => new Date("invalid"),
    });
    expect(() => scheduler.evaluate()).toThrow(SchedulerError);
  });

  it("snapshotとintentを実行時にも変更不能にする", () => {
    const scheduler = createWeekdayScheduler(
      new FakeClock("2026-08-05T01:00:00.000Z"),
    );
    const evaluation = scheduler.evaluate();
    expect(Object.isFrozen(evaluation)).toBe(true);
    expect(Object.isFrozen(evaluation.intents)).toBe(true);
    expect(Object.isFrozen(evaluation.intents[0])).toBe(true);
    expect(Object.isFrozen(evaluation.intents[0]?.window)).toBe(true);
  });
});
