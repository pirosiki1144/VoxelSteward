import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BedrockReadonlyConnection } from "./adapters/minecraft/bedrock-connection.js";
import { createLogger } from "./infrastructure/logger.js";
import { loadSmokeConfig } from "./smoke/config.js";
import { SmokeSession } from "./smoke/session.js";

interface LockRecord {
  owner: string;
  heartbeat: number;
}

class InstanceLock {
  readonly #file: string;
  readonly #owner = crypto.randomUUID();
  #heartbeat?: NodeJS.Timeout;

  constructor(folder: string, accountId: string) {
    const safeAccountId = accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
    this.#file = path.join(folder, `${safeAccountId}.lock`);
  }

  async acquire(): Promise<void> {
    await mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      await this.#create();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "EEXIST"
      ) {
        throw error;
      }
      const existing = await this.#read();
      if (existing !== undefined && Date.now() - existing.heartbeat < 30_000) {
        throw new Error("another smoke test instance is active");
      }
      await rename(this.#file, `${this.#file}.stale-${this.#owner}`);
      await this.#create();
    }
    this.#heartbeat = setInterval(() => {
      void this.#write();
    }, 5_000);
  }

  async release(): Promise<void> {
    if (this.#heartbeat !== undefined) clearInterval(this.#heartbeat);
    const current = await this.#read();
    if (current?.owner === this.#owner) await unlink(this.#file);
  }

  async #create(): Promise<void> {
    const handle = await open(this.#file, "wx", 0o600);
    await handle.writeFile(JSON.stringify(this.#record()));
    await handle.close();
  }

  async #write(): Promise<void> {
    const handle = await open(this.#file, "w", 0o600);
    await handle.writeFile(JSON.stringify(this.#record()));
    await handle.close();
  }

  async #read(): Promise<LockRecord | undefined> {
    try {
      return JSON.parse(await readFile(this.#file, "utf8")) as LockRecord;
    } catch {
      return undefined;
    }
  }

  #record(): LockRecord {
    return { owner: this.#owner, heartbeat: Date.now() };
  }
}

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
    logger.log("error", {
      event: "smoke.start_failed",
      error: error instanceof Error ? error.message : "unknown startup error",
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
