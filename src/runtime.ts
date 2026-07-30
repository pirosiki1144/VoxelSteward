import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { InstanceLock } from "./infrastructure/instance-lock.js";
import { createLogger } from "./infrastructure/logger.js";
import { loadRuntimeConfig } from "./runtime/config.js";
import { RuntimeSupervisor } from "./runtime/supervisor.js";

const main = async (): Promise<void> => {
  let lock: InstanceLock | undefined;
  let removeSignals = (): void => undefined;
  try {
    const config = loadRuntimeConfig();
    const logger = createLogger(config.mode, config.logLevel);
    lock = new InstanceLock(config.authProfilesFolder, config.accountId);
    await lock.acquire();

    const supervisor = new RuntimeSupervisor(
      config,
      () => new BedrockReadonlyConnection(config, logger),
      logger,
    );
    const onSigint = () => {
      logger.log("info", { event: "signal.received", signal: "SIGINT" });
      supervisor.requestStop("signal_sigint");
    };
    const onSigterm = () => {
      logger.log("info", { event: "signal.received", signal: "SIGTERM" });
      supervisor.requestStop("signal_sigterm");
    };
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
    removeSignals = () => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    };

    const result = await supervisor.run();
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
    await lock?.release();
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  await main();
}
