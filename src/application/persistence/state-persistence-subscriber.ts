import type { StateChangeEvent, StateStore } from "../../domain/state/index.js";
import type { StatePersistenceRepository } from "../../ports/state-persistence-repository.js";
import { mapStateChangeToNotification } from "../notifications/index.js";

export type PersistenceWait = (delayMs: number) => Promise<void>;
export type PersistenceErrorReporter = (
  error: unknown,
  event: StateChangeEvent,
  attempts: number,
) => void;

export interface StatePersistenceSubscriberOptions {
  readonly maxAttempts?: number;
  readonly wait?: PersistenceWait;
  readonly onError?: PersistenceErrorReporter;
}

export class StatePersistenceSubscriber {
  readonly #repository: StatePersistenceRepository;
  readonly #runId: string;
  readonly #maxAttempts: number;
  readonly #wait: PersistenceWait;
  readonly #onError: PersistenceErrorReporter;
  #lastAcceptedRevision = -1;
  #tail: Promise<void> = Promise.resolve();
  #unsubscribe: (() => void) | undefined;
  #closed = false;

  constructor(
    repository: StatePersistenceRepository,
    runId: string,
    options: StatePersistenceSubscriberOptions = {},
  ) {
    this.#repository = repository;
    this.#runId = runId;
    this.#maxAttempts = options.maxAttempts ?? 3;
    this.#wait =
      options.wait ??
      ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.#onError = options.onError ?? (() => undefined);
    if (
      !Number.isSafeInteger(this.#maxAttempts) ||
      this.#maxAttempts < 1 ||
      this.#maxAttempts > 10
    ) {
      throw new RangeError("maxAttempts must be from 1 through 10");
    }
  }

  subscribe(store: StateStore): void {
    if (this.#closed) throw new Error("StatePersistenceSubscriber is closed");
    if (this.#unsubscribe !== undefined)
      throw new Error("StatePersistenceSubscriber is already subscribed");
    this.#lastAcceptedRevision = store.getSnapshot().revision;
    this.#unsubscribe = store.subscribe((event) => this.accept(event));
  }

  accept(event: StateChangeEvent): void {
    if (this.#closed || event.revision <= this.#lastAcceptedRevision) return;
    this.#lastAcceptedRevision = event.revision;
    this.#tail = this.#tail.then(() => this.#persistWithRetry(event));
  }

  async flush(): Promise<void> {
    await Promise.resolve();
    await this.#tail;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  async #persistWithRetry(event: StateChangeEvent): Promise<void> {
    const notification = mapStateChangeToNotification(event);
    let attempts = 0;
    while (attempts < this.#maxAttempts && (attempts === 0 || !this.#closed)) {
      attempts += 1;
      try {
        await this.#repository.persist(this.#runId, event, notification);
        return;
      } catch (error) {
        const retryable = this.#isRetryable(error);
        if (!retryable || attempts >= this.#maxAttempts || this.#closed) {
          this.#report(error, event, attempts);
          return;
        }
        await this.#wait(100 * 2 ** (attempts - 1));
      }
    }
  }

  #isRetryable(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "PersistenceError" &&
      "retryable" in error &&
      error.retryable === true
    );
  }

  #report(error: unknown, event: StateChangeEvent, attempts: number): void {
    try {
      this.#onError(error, event, attempts);
    } catch {
      // Persistence reporting is observational and must not recurse.
    }
  }
}
