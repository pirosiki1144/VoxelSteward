import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { ScheduledRuntimeController } from "./application/scheduling/index.js";
import { createWeekdayScheduler } from "./domain/scheduler/index.js";
import { createLogger } from "./infrastructure/logger.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { loadNotificationConfig } from "./runtime/notification-config.js";
import { loadPersistenceConfig } from "./runtime/persistence-config.js";
import { loadSchedulerRuntimeConfig } from "./runtime/scheduler-config.js";
import { createLockedRuntimeSession } from "./runtime/session.js";

export const main = async (): Promise<void> => {
  let controller: ScheduledRuntimeController | undefined;
  let removeSignals = (): void => undefined;
  try {
    const notificationConfig = loadNotificationConfig();
    const persistenceConfig = loadPersistenceConfig();
    const runtimeConfig = loadRuntimeConfig();
    const schedulerConfig = loadSchedulerRuntimeConfig();
    const logger = createLogger(runtimeConfig.mode, runtimeConfig.logLevel);
    controller = new ScheduledRuntimeController({
      scheduler: createWeekdayScheduler({ now: () => new Date() }),
      pollIntervalMs: schedulerConfig.pollIntervalMs,
      createSession: async () =>
        createLockedRuntimeSession({
          config: runtimeConfig,
          notificationConfig,
          persistenceConfig,
          logger,
          createConnection: () =>
            new BedrockReadonlyConnection(runtimeConfig, logger),
        }),
      onEvent: (event) => {
        if (event.type === "schedule.intent_processed") {
          logger.log("info", {
            event: event.intent,
            phase: event.phase,
            windowId: event.windowId,
          });
          return;
        }
        if (event.type === "schedule.session_finished") {
          logger.log(event.result.exitCode === 0 ? "info" : "error", {
            event: "schedule.session_finished",
            windowId: event.windowId,
            reason: event.result.reason,
            exitCode: event.result.exitCode,
          });
          return;
        }
        logger.log("error", {
          event: "schedule.session_start_failed",
          windowId: event.windowId,
        });
      },
    });
    const onSigint = (): void => {
      logger.log("info", { event: "signal.received", signal: "SIGINT" });
      controller?.requestStop("signal_sigint");
    };
    const onSigterm = (): void => {
      logger.log("info", { event: "signal.received", signal: "SIGTERM" });
      controller?.requestStop("signal_sigterm");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    removeSignals = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    await controller.run();
    process.exitCode = 0;
  } catch {
    createLogger("normal", "info").log("error", {
      event: "scheduled_runtime.finished",
      reason: "startup_error",
      outcome: "abnormal",
      exitCode: 1,
    });
    process.exitCode = 1;
  } finally {
    removeSignals();
    await controller?.close();
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  await main();
}
