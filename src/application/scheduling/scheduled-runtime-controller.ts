import type { OperatingWindow } from "../../domain/scheduler/index.js";
import type { RuntimeResult, RuntimeStopReason } from "../../runtime/types.js";
import type {
  ScheduledRuntimeControllerOptions,
  ScheduledRuntimeEvent,
  ScheduledRuntimeSession,
  SchedulerWait,
} from "./types.js";

const defaultWait: SchedulerWait = (delayMs, signal) =>
  new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, delayMs);
    signal.addEventListener("abort", finish, { once: true });
  });

interface ActiveSession {
  readonly window: OperatingWindow;
  readonly session: ScheduledRuntimeSession;
  readonly completion: Promise<RuntimeResult>;
}

export class ScheduledRuntimeController {
  readonly #options: ScheduledRuntimeControllerOptions;
  readonly #pollIntervalMs: number;
  readonly #wait: SchedulerWait;
  readonly #abort = new AbortController();
  readonly #sessionFinalizers = new WeakMap<
    ScheduledRuntimeSession,
    Promise<void>
  >();
  #active: ActiveSession | undefined;
  #stopReason:
    | Extract<
        RuntimeStopReason,
        "signal_sigint" | "signal_sigterm" | "stop_requested"
      >
    | undefined;
  #running = false;
  #closed = false;

  constructor(options: ScheduledRuntimeControllerOptions) {
    this.#options = options;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.#wait = options.wait ?? defaultWait;
    if (
      !Number.isSafeInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 100 ||
      this.#pollIntervalMs > 60_000
    ) {
      throw new RangeError("pollIntervalMs must be from 100 through 60000");
    }
  }

  async run(): Promise<void> {
    if (this.#running) throw new Error("Scheduled runtime is already running");
    if (this.#closed) return;
    this.#running = true;
    try {
      while (!this.#closed) {
        await this.evaluateOnce();
        if (!this.#closed) {
          await this.#wait(this.#pollIntervalMs, this.#abort.signal);
        }
      }
    } finally {
      await this.#stopActive(this.#stopReason ?? "stop_requested");
      this.#running = false;
    }
  }

  async evaluateOnce(): Promise<void> {
    if (this.#closed) return;
    const evaluation = this.#options.scheduler.evaluate();
    for (const intent of evaluation.intents) {
      if (this.#closed) break;
      if (intent.type === "schedule.stop_requested") {
        if (this.#active?.window.id === intent.window.id) {
          this.#active.session.recordScheduleIntent(intent, evaluation.phase);
          this.#report({
            type: "schedule.intent_processed",
            intent: intent.type,
            phase: evaluation.phase,
            windowId: intent.window.id,
          });
          await this.#stopActive("schedule_window_ended");
        }
        continue;
      }
      if (this.#active !== undefined) continue;
      try {
        const session = await this.#options.createSession(intent.window);
        if (this.#closed) {
          await session.close();
          break;
        }
        session.recordScheduleIntent(intent, evaluation.phase);
        const completion = session.run().catch((): RuntimeResult => ({
          reason: "internal_error",
          exitCode: 1,
        }));
        const active: ActiveSession = {
          window: intent.window,
          session,
          completion,
        };
        this.#active = active;
        void active.completion.then(async (result) => {
          this.#report({
            type: "schedule.session_finished",
            windowId: active.window.id,
            result,
          });
          await this.#finalize(active);
        });
        this.#report({
          type: "schedule.intent_processed",
          intent: intent.type,
          phase: evaluation.phase,
          windowId: intent.window.id,
        });
      } catch {
        this.#report({
          type: "schedule.session_start_failed",
          windowId: intent.window.id,
        });
      }
    }
  }

  requestStop(
    reason: Extract<
      RuntimeStopReason,
      "signal_sigint" | "signal_sigterm" | "stop_requested"
    >,
  ): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#stopReason = reason;
    this.#abort.abort();
    this.#active?.session.requestStop(reason);
  }

  async close(): Promise<void> {
    this.requestStop("stop_requested");
    if (!this.#running)
      await this.#stopActive(this.#stopReason ?? "stop_requested");
  }

  async #stopActive(
    reason: Extract<
      RuntimeStopReason,
      | "schedule_window_ended"
      | "signal_sigint"
      | "signal_sigterm"
      | "stop_requested"
    >,
  ): Promise<void> {
    const active = this.#active;
    if (active === undefined) return;
    active.session.requestStop(reason);
    try {
      await active.completion;
    } finally {
      await this.#finalize(active);
    }
  }

  async #finalize(active: ActiveSession): Promise<void> {
    let finalizer = this.#sessionFinalizers.get(active.session);
    if (finalizer === undefined) {
      finalizer = active.session.close().catch(() => undefined);
      this.#sessionFinalizers.set(active.session, finalizer);
    }
    await finalizer;
    if (this.#active === active) this.#active = undefined;
  }

  #report(event: ScheduledRuntimeEvent): void {
    try {
      this.#options.onEvent?.(event);
    } catch {
      // Observability must not affect scheduling or safe shutdown.
    }
  }
}
