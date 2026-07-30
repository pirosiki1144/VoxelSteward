import type { StateChangeEvent, StateStore } from "../../domain/state/index.js";
import type {
  NotificationMessage,
  NotificationPort,
} from "../../ports/notification-port.js";
import { mapStateChangeToNotification } from "./notification-mapper.js";
import type { NotificationErrorReporter } from "./types.js";

export interface NotificationSubscriberOptions {
  readonly onNotificationError?: NotificationErrorReporter;
  readonly deduplicationCapacity?: number;
}

export class NotificationSubscriber {
  readonly #port: NotificationPort;
  readonly #onNotificationError: NotificationErrorReporter;
  readonly #deduplicationCapacity: number;
  readonly #seenIds = new Set<string>();
  readonly #seenOrder: string[] = [];
  #lastAcceptedRevision = -1;
  #tail: Promise<void> = Promise.resolve();
  #unsubscribe: (() => void) | undefined;
  #closed = false;

  constructor(
    port: NotificationPort,
    options: NotificationSubscriberOptions = {},
  ) {
    this.#port = port;
    this.#onNotificationError =
      options.onNotificationError ?? (() => undefined);
    this.#deduplicationCapacity = options.deduplicationCapacity ?? 256;
    if (
      !Number.isSafeInteger(this.#deduplicationCapacity) ||
      this.#deduplicationCapacity < 1
    ) {
      throw new RangeError("deduplicationCapacity must be a positive integer");
    }
  }

  subscribe(stateStore: StateStore): () => void {
    if (this.#closed) {
      throw new Error("NotificationSubscriber is closed");
    }
    if (this.#unsubscribe !== undefined) {
      throw new Error("NotificationSubscriber is already subscribed");
    }
    this.#lastAcceptedRevision = stateStore.getSnapshot().revision;
    this.#unsubscribe = stateStore.subscribe((event) => {
      this.accept(event);
    });
    return () => this.unsubscribe();
  }

  accept(event: StateChangeEvent): void {
    if (this.#closed || event.revision <= this.#lastAcceptedRevision) return;
    this.#lastAcceptedRevision = event.revision;

    let message: NotificationMessage | undefined;
    try {
      message = mapStateChangeToNotification(event);
    } catch (error) {
      this.#report(error, undefined);
      return;
    }
    if (message === undefined || this.#seenIds.has(message.notificationId)) {
      return;
    }
    this.#remember(message.notificationId);

    this.#tail = this.#tail
      .then(() => this.#port.send(message))
      .catch((error: unknown) => {
        this.#report(error, message);
      });
  }

  async flush(): Promise<void> {
    await Promise.resolve();
    await this.#tail;
  }

  unsubscribe(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.unsubscribe();
  }

  #remember(notificationId: string): void {
    this.#seenIds.add(notificationId);
    this.#seenOrder.push(notificationId);
    while (this.#seenOrder.length > this.#deduplicationCapacity) {
      const expired = this.#seenOrder.shift();
      if (expired !== undefined) this.#seenIds.delete(expired);
    }
  }

  #report(error: unknown, message: NotificationMessage | undefined): void {
    try {
      this.#onNotificationError(error, message);
    } catch {
      // Notification error reporting is observational and must not recurse.
    }
  }
}
