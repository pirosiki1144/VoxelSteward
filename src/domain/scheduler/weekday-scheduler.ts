import { SchedulerError } from "./errors.js";
import type {
  OperatingSlot,
  OperatingWindow,
  ScheduleEvaluation,
  ScheduleIntent,
  SchedulePhase,
  SchedulerClock,
  WeekdayScheduler,
} from "./types.js";

export const SCHEDULER_TIME_ZONE = "Asia/Tokyo";

const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const MORNING_START_MINUTE = 9 * 60;
const MORNING_END_MINUTE = 11 * 60 + 59;
const AFTERNOON_START_MINUTE = 12 * 60;
const AFTERNOON_END_MINUTE = 17 * 60;

interface LocalTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly weekday: number;
  readonly minuteOfDay: number;
}

interface WindowEvaluation {
  readonly phase: SchedulePhase;
  readonly window?: OperatingWindow;
}

const localTime = (date: Date): LocalTime => {
  const local = new Date(date.getTime() + JST_OFFSET_MS);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
};

const utcBoundary = (local: LocalTime, hour: number, minute: number): string =>
  new Date(
    Date.UTC(local.year, local.month - 1, local.day, hour, minute) -
      JST_OFFSET_MS,
  ).toISOString();

const dateKey = (local: LocalTime): string =>
  `${String(local.year).padStart(4, "0")}-${String(local.month).padStart(2, "0")}-${String(local.day).padStart(2, "0")}`;

const window = (local: LocalTime, slot: OperatingSlot): OperatingWindow => {
  const morning = slot === "morning";
  return Object.freeze({
    id: `${dateKey(local)}:${slot}`,
    slot,
    startsAt: utcBoundary(local, morning ? 9 : 12, 0),
    endsAt: utcBoundary(local, morning ? 11 : 17, morning ? 59 : 0),
  });
};

export const evaluateWeekdayWindow = (date: Date): WindowEvaluation => {
  if (Number.isNaN(date.getTime())) throw new SchedulerError();
  const local = localTime(date);
  if (local.weekday === 0 || local.weekday === 6) {
    return Object.freeze({ phase: "outside_hours" });
  }
  if (
    local.minuteOfDay >= MORNING_START_MINUTE &&
    local.minuteOfDay < MORNING_END_MINUTE
  ) {
    return Object.freeze({
      phase: "morning",
      window: window(local, "morning"),
    });
  }
  if (
    local.minuteOfDay >= MORNING_END_MINUTE &&
    local.minuteOfDay < AFTERNOON_START_MINUTE
  ) {
    return Object.freeze({ phase: "handoff" });
  }
  if (
    local.minuteOfDay >= AFTERNOON_START_MINUTE &&
    local.minuteOfDay < AFTERNOON_END_MINUTE
  ) {
    return Object.freeze({
      phase: "afternoon",
      window: window(local, "afternoon"),
    });
  }
  return Object.freeze({ phase: "outside_hours" });
};

const freezeIntent = (intent: ScheduleIntent): ScheduleIntent =>
  Object.freeze(intent);

class InMemoryWeekdayScheduler implements WeekdayScheduler {
  readonly #clock: SchedulerClock;
  #lastEvaluatedTime: number | undefined;
  #activeWindow: OperatingWindow | undefined;

  constructor(clock: SchedulerClock) {
    this.#clock = clock;
  }

  evaluate(): ScheduleEvaluation {
    const current = this.#clock.now();
    const currentTime = current.getTime();
    if (Number.isNaN(currentTime)) throw new SchedulerError();
    const evaluatedAt = current.toISOString();
    const evaluated = evaluateWeekdayWindow(current);

    if (
      this.#lastEvaluatedTime !== undefined &&
      currentTime <= this.#lastEvaluatedTime
    ) {
      return Object.freeze({
        phase: evaluated.phase,
        evaluatedAt,
        intents: Object.freeze([]),
      });
    }
    this.#lastEvaluatedTime = currentTime;

    const intents: ScheduleIntent[] = [];
    if (
      this.#activeWindow !== undefined &&
      this.#activeWindow.id !== evaluated.window?.id
    ) {
      intents.push(
        freezeIntent({
          type: "schedule.stop_requested",
          window: this.#activeWindow,
          evaluatedAt,
        }),
      );
      this.#activeWindow = undefined;
    }
    if (
      evaluated.window !== undefined &&
      this.#activeWindow?.id !== evaluated.window.id
    ) {
      this.#activeWindow = evaluated.window;
      intents.push(
        freezeIntent({
          type: "schedule.start_requested",
          window: evaluated.window,
          evaluatedAt,
        }),
      );
    }

    return Object.freeze({
      phase: evaluated.phase,
      evaluatedAt,
      intents: Object.freeze(intents),
    });
  }
}

export const createWeekdayScheduler = (
  clock: SchedulerClock,
): WeekdayScheduler => new InMemoryWeekdayScheduler(clock);
