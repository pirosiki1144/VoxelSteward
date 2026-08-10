export type OperatingSlot = "morning" | "afternoon";

export type SchedulePhase =
  "outside_hours" | "morning" | "handoff" | "afternoon";

export interface SchedulerClock {
  now(): Date;
}

export interface OperatingWindow {
  readonly id: string;
  readonly slot: OperatingSlot;
  readonly startsAt: string;
  readonly endsAt: string;
}

export type ScheduleIntent =
  | {
      readonly type: "schedule.start_requested";
      readonly window: OperatingWindow;
      readonly evaluatedAt: string;
    }
  | {
      readonly type: "schedule.stop_requested";
      readonly window: OperatingWindow;
      readonly evaluatedAt: string;
    };

export interface ScheduleEvaluation {
  readonly phase: SchedulePhase;
  readonly evaluatedAt: string;
  readonly intents: readonly ScheduleIntent[];
}

export interface WeekdayScheduler {
  evaluate(): ScheduleEvaluation;
}
