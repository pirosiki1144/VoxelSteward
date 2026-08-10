import { parseInteger } from "../smoke/config.js";

export interface SchedulerRuntimeConfig {
  readonly pollIntervalMs: number;
}

export const loadSchedulerRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): SchedulerRuntimeConfig =>
  Object.freeze({
    pollIntervalMs: parseInteger(
      "SCHEDULER_POLL_INTERVAL_MS",
      environment.SCHEDULER_POLL_INTERVAL_MS,
      1_000,
      100,
      60_000,
    ),
  });
