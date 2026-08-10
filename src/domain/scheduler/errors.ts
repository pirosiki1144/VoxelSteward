export class SchedulerError extends Error {
  override readonly name = "SchedulerError";
  readonly code = "INVALID_SCHEDULER_CLOCK";

  constructor() {
    super("Scheduler clock is invalid");
  }
}
