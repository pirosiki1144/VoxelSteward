import {
  DiscordWebhookNotificationPort,
  type DiscordWebhookNotificationPortOptions,
} from "../adapters/notifications/discord-webhook-notification-port.js";
import { NoopNotificationPort } from "../application/notifications/index.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { NotificationConfig } from "./notification-config.js";

export interface RuntimeNotificationBinding {
  readonly port: NotificationPort;
  close(): void;
}

type WebhookDependencies = Omit<
  DiscordWebhookNotificationPortOptions,
  "webhookUrl" | "requestTimeoutMs" | "maxAttempts" | "totalBudgetMs"
>;

export const createRuntimeNotificationBinding = (
  config: NotificationConfig,
  dependencies: WebhookDependencies = {},
): RuntimeNotificationBinding => {
  if (!config.enabled) {
    return Object.freeze({
      port: new NoopNotificationPort(),
      close: () => undefined,
    });
  }

  const port = new DiscordWebhookNotificationPort({
    webhookUrl: config.webhookUrl,
    requestTimeoutMs: config.requestTimeoutMs,
    maxAttempts: config.maxAttempts,
    totalBudgetMs: config.totalBudgetMs,
    ...dependencies,
  });
  return Object.freeze({
    port,
    close: () => port.close(),
  });
};
