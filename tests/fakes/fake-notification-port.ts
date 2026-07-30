import type {
  NotificationMessage,
  NotificationPort,
} from "../../src/application/notifications/index.js";

export type FakeNotificationHandler = (
  message: NotificationMessage,
) => Promise<void>;

export class FakeNotificationPort implements NotificationPort {
  readonly messages: NotificationMessage[] = [];
  readonly #handler: FakeNotificationHandler | undefined;

  constructor(handler?: FakeNotificationHandler) {
    this.#handler = handler;
  }

  send(message: NotificationMessage): Promise<void> {
    this.messages.push(message);
    return this.#handler?.(message) ?? Promise.resolve();
  }
}
