import type { NotificationMessage } from "../../ports/notification-port.js";

export type NotificationErrorReporter = (
  error: unknown,
  message: NotificationMessage | undefined,
) => void;
