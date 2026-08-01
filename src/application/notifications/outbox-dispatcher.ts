import type { NotificationPort } from "../../ports/notification-port.js";
import type {
  NotificationOutboxRepository,
  NotificationOutboxRecord,
} from "../../ports/notification-outbox-repository.js";

export interface OutboxDispatcherOptions {
  readonly workerId: string;
  readonly maxAttempts?: number;
  readonly leaseDurationMs?: number;
  readonly pollIntervalMs?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly now?: () => Date;
  readonly wait?: (delayMs: number) => Promise<void>;
  readonly toSafeErrorCode?: (error: unknown) => string;
  readonly onError?: (
    error: unknown,
    record: NotificationOutboxRecord | undefined,
  ) => void;
}

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
};

export class OutboxDispatcher {
  readonly #repository: NotificationOutboxRepository;
  readonly #port: NotificationPort;
  readonly #workerId: string;
  readonly #maxAttempts: number;
  readonly #leaseDurationMs: number;
  readonly #pollIntervalMs: number;
  readonly #retryBaseDelayMs: number;
  readonly #retryMaxDelayMs: number;
  readonly #now: () => Date;
  readonly #wait: (delayMs: number) => Promise<void>;
  readonly #toSafeErrorCode: (error: unknown) => string;
  readonly #onError: (
    error: unknown,
    record: NotificationOutboxRecord | undefined,
  ) => void;
  #stopping = false;
  #loop: Promise<void> | undefined;
  #wake: (() => void) | undefined;

  constructor(
    repository: NotificationOutboxRepository,
    port: NotificationPort,
    options: OutboxDispatcherOptions,
  ) {
    this.#repository = repository;
    this.#port = port;
    this.#workerId = options.workerId;
    this.#maxAttempts = options.maxAttempts ?? 5;
    this.#leaseDurationMs = options.leaseDurationMs ?? 30_000;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.#retryMaxDelayMs = options.retryMaxDelayMs ?? 60_000;
    this.#now = options.now ?? (() => new Date());
    this.#wait = options.wait ?? ((delay) => this.#interruptibleWait(delay));
    this.#toSafeErrorCode =
      options.toSafeErrorCode ?? (() => "DELIVERY_FAILED");
    this.#onError = options.onError ?? (() => undefined);
    if (this.#workerId.length === 0 || this.#workerId.length > 128)
      throw new RangeError("workerId must contain 1 through 128 characters");
    assertPositiveInteger("maxAttempts", this.#maxAttempts);
    assertPositiveInteger("leaseDurationMs", this.#leaseDurationMs);
    assertPositiveInteger("pollIntervalMs", this.#pollIntervalMs);
    assertPositiveInteger("retryBaseDelayMs", this.#retryBaseDelayMs);
    assertPositiveInteger("retryMaxDelayMs", this.#retryMaxDelayMs);
  }

  start(): void {
    if (this.#loop !== undefined)
      throw new Error("OutboxDispatcher already started");
    if (this.#stopping) throw new Error("OutboxDispatcher is stopped");
    this.#loop = this.#runLoop();
  }

  async dispatchAvailable(): Promise<number> {
    let delivered = 0;
    while (!this.#stopping) {
      const record = await this.#repository.claimNext(
        this.#workerId,
        this.#now().toISOString(),
        this.#leaseDurationMs,
        this.#maxAttempts,
      );
      if (record === undefined) break;
      if (!(await this.#deliver(record))) break;
      delivered += 1;
    }
    return delivered;
  }

  async stop(): Promise<void> {
    if (this.#stopping) {
      await this.#loop;
      return;
    }
    this.#stopping = true;
    this.#wake?.();
    await this.#loop;
  }

  async #runLoop(): Promise<void> {
    while (!this.#stopping) {
      try {
        await this.dispatchAvailable();
      } catch (error) {
        this.#report(error, undefined);
      }
      if (!this.#stopping) await this.#wait(this.#pollIntervalMs);
    }
  }

  async #deliver(record: NotificationOutboxRecord): Promise<boolean> {
    try {
      await this.#port.send(record.message);
      const marked = await this.#repository.markDelivered(
        record,
        this.#workerId,
        this.#now().toISOString(),
      );
      if (!marked) this.#report(new Error("OUTBOX_LEASE_LOST"), record);
      return marked;
    } catch (error) {
      const delay = Math.min(
        this.#retryMaxDelayMs,
        this.#retryBaseDelayMs * 2 ** Math.max(0, record.attempts - 1),
      );
      const failedAt = this.#now();
      try {
        const status = await this.#repository.markFailed(
          record,
          this.#workerId,
          failedAt.toISOString(),
          new Date(failedAt.getTime() + delay).toISOString(),
          this.#safeErrorCode(error),
        );
        if (status === undefined)
          this.#report(new Error("OUTBOX_LEASE_LOST"), record);
      } catch (persistenceError) {
        this.#report(persistenceError, record);
      }
      this.#report(error, record);
      return false;
    }
  }

  #safeErrorCode(error: unknown): string {
    try {
      const code = this.#toSafeErrorCode(error);
      return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "DELIVERY_FAILED";
    } catch {
      return "DELIVERY_FAILED";
    }
  }

  #report(error: unknown, record: NotificationOutboxRecord | undefined): void {
    try {
      this.#onError(error, record);
    } catch {
      // Reporting is observational and must never stop the dispatcher.
    }
  }

  #interruptibleWait(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#wake = undefined;
        resolve();
      }, delayMs);
      this.#wake = () => {
        clearTimeout(timer);
        this.#wake = undefined;
        resolve();
      };
    });
  }
}
