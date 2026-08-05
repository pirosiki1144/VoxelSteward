import type {
  OperatingWindow,
  ScheduleIntent,
  SchedulePhase,
  WeekdayScheduler,
} from "../../domain/scheduler/index.js";
import type { RuntimeResult, RuntimeStopReason } from "../../runtime/types.js";

export interface ScheduledRuntimeSession {
  recordScheduleIntent(intent: ScheduleIntent, phase: SchedulePhase): void;
  run(): Promise<RuntimeResult>;
  requestStop(
    reason: Extract<
      RuntimeStopReason,
      | "schedule_window_ended"
      | "signal_sigint"
      | "signal_sigterm"
      | "stop_requested"
    >,
  ): void;
  close(): Promise<void>;
}

export type ScheduledRuntimeSessionFactory = (
  window: OperatingWindow,
) => Promise<ScheduledRuntimeSession>;

export type SchedulerWait = (
  delayMs: number,
  signal: AbortSignal,
) => Promise<void>;

export type ScheduledRuntimeEvent =
  | {
      readonly type: "schedule.intent_processed";
      readonly intent: ScheduleIntent["type"];
      readonly phase: SchedulePhase;
      readonly windowId: string;
    }
  | {
      readonly type: "schedule.session_finished";
      readonly windowId: string;
      readonly result: RuntimeResult;
    }
  | {
      readonly type: "schedule.session_start_failed";
      readonly windowId: string;
    };

export interface ScheduledRuntimeControllerOptions {
  readonly scheduler: WeekdayScheduler;
  readonly createSession: ScheduledRuntimeSessionFactory;
  readonly pollIntervalMs?: number;
  readonly wait?: SchedulerWait;
  readonly onEvent?: (event: ScheduledRuntimeEvent) => void;
}
