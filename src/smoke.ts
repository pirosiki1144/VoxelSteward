import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { InstanceLock } from "./infrastructure/instance-lock.js";
import { createLogger } from "./infrastructure/logger.js";
import { loadSmokeConfig } from "./smoke/config.js";
import { SmokeSession } from "./smoke/session.js";
import { minecraftVersionErrorLogFields } from "./smoke/minecraft-version.js";

const main = async (): Promise<void> => {
  let lock: InstanceLock | undefined;
  try {
    const config = loadSmokeConfig();
    const logger = createLogger(config.mode, config.logLevel);
    lock = new InstanceLock(config.authProfilesFolder, config.accountId);
    await lock.acquire();

    const connection = new BedrockReadonlyConnection(config, logger);
    const session = new SmokeSession(connection, config, logger);
    const onSigint = () => session.requestStop("signal_sigint");
    const onSigterm = () => session.requestStop("signal_sigterm");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const result = await session.run();
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    process.exitCode = result.exitCode;
  } catch (error) {
    const logger = createLogger("normal", "info");
    const versionError = minecraftVersionErrorLogFields(error);
    logger.log("error", {
      event: "smoke.start_failed",
      ...(versionError ?? {
        error: error instanceof Error ? error.message : "unknown startup error",
      }),
      outcome: "abnormal",
      exitCode: 1,
    });
    process.exitCode = 1;
  } finally {
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
