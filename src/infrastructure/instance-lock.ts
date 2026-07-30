import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";

interface LockRecord {
  owner: string;
  heartbeat: number;
}

export class InstanceLock {
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
        throw new Error("another bot instance is active");
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
