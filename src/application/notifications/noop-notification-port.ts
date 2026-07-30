import type { NotificationPort } from "../../ports/notification-port.js";
export class NoopNotificationPort implements NotificationPort {
  send(): Promise<void> {
    return Promise.resolve();
  }
}
