import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { createLogger } from "./infrastructure/logger.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { loadNotificationConfig } from "./runtime/notification-config.js";
import { loadPersistenceConfig } from "./runtime/persistence-config.js";
import {
  createLockedRuntimeSession,
  type RuntimeSession,
} from "./runtime/session.js";

export const main = async (): Promise<void> => {
  let session: RuntimeSession | undefined;
  let removeSignals = (): void => undefined;
  try {
    const notificationConfig = loadNotificationConfig();
    const persistenceConfig = loadPersistenceConfig();
    const config = loadRuntimeConfig();
    const logger = createLogger(config.mode, config.logLevel);
    session = await createLockedRuntimeSession({
      config,
      notificationConfig,
      persistenceConfig,
      logger,
      createConnection: () => new BedrockReadonlyConnection(config, logger),
    });
    const onSigint = (): void => {
      logger.log("info", { event: "signal.received", signal: "SIGINT" });
      session?.requestStop("signal_sigint");
    };
    const onSigterm = (): void => {
      logger.log("info", { event: "signal.received", signal: "SIGTERM" });
      session?.requestStop("signal_sigterm");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    removeSignals = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };
    const result = await session.run();
    process.exitCode = result.exitCode;
  } catch (error) {
    const logger = createLogger("normal", "info");
    logger.log("error", {
      event: "runtime.error",
      reason: "startup_error",
      error: error instanceof Error ? error.message : "unknown startup error",
      outcome: "abnormal",
      exitCode: 1,
    });
    logger.log("error", {
      event: "runtime.finished",
      reason: "startup_error",
      outcome: "abnormal",
      exitCode: 1,
    });
    process.exitCode = 1;
  } finally {
    removeSignals();
    await session?.close();
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  await main();
}
