import { describe, expect, it, vi } from "vitest";

import {
  loadNotificationConfig,
  NotificationConfigError,
} from "../src/runtime/notification-config.js";
import { createRuntimeNotificationBinding } from "../src/runtime/notification-port-factory.js";
import { NoopNotificationPort } from "../src/application/notifications/index.js";
import { DiscordWebhookNotificationPort } from "../src/adapters/notifications/discord-webhook-notification-port.js";

const validUrl = "https://discord.com/api/webhooks/1234567890/token_value";

describe("notification config", () => {
  it.each([undefined, "false"] as const)(
    "%sはdisabledとしてURLを参照しない",
    (enabled) => {
      const config = loadNotificationConfig({
        DISCORD_NOTIFICATIONS_ENABLED: enabled,
        DISCORD_WEBHOOK_URL: "not a URL",
      });
      expect(config).toEqual({ enabled: false });
      expect(createRuntimeNotificationBinding(config).port).toBeInstanceOf(
        NoopNotificationPort,
      );
    },
  );

  it("trueは固定された配送設定を返す", () => {
    const config = loadNotificationConfig({
      DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_WEBHOOK_URL: validUrl,
    });
    expect(config).toMatchObject({
      enabled: true,
      requestTimeoutMs: 5_000,
      maxAttempts: 3,
      totalBudgetMs: 15_000,
    });
    expect(createRuntimeNotificationBinding(config).port).toBeInstanceOf(
      DiscordWebhookNotificationPort,
    );
  });

  it.each(["TRUE", "False", " true", "false "])(
    "フラグ%sを黙って補正しない",
    (enabled) => {
      expect(() =>
        loadNotificationConfig({
          DISCORD_NOTIFICATIONS_ENABLED: enabled,
          DISCORD_WEBHOOK_URL: validUrl,
        }),
      ).toThrow(NotificationConfigError);
    },
  );

  it.each([
    "",
    "not-a-url",
    "http://discord.com/api/webhooks/123/token",
    "https://discord.com.example.com/api/webhooks/123/token",
    "https://example.com/api/webhooks/123/token",
    "https://user@discord.com/api/webhooks/123/token",
    "https://user:password@discord.com/api/webhooks/123/token",
    "https://discord.com:443/api/webhooks/123/token",
    "https://discord.com/api/webhooks/123/token#fragment",
    "https://discord.com/api/webhooks/123/token?wait=true",
    "https://discord.com/api/webhooks/123/token?",
    "https://discord.com/api/webhooks/123/token#",
    "https://discord.com/api/webhooks/not-numeric/token",
    "https://discord.com/api/webhooks/123/",
    "https://discord.com/api/webhooks/123/token/",
    "https://discord.com/api//webhooks/123/token",
    "https://discord.com/api/webhooks//123/token",
    "https://discord.com/api/webhooks/123//token",
    "https://discord.com/api\\webhooks\\123\\token",
    "https://discord.com/api/webhooks/%31%32%33/token",
    "https://discord.com/api/webhooks/123/token%2Fextra",
    "https://discord.com/api/v9/webhooks/123/token",
    "https://discord.com/not-api/webhooks/123/token",
  ])("有効時に不正URLを安全に拒否する", (url) => {
    let captured: unknown;
    try {
      loadNotificationConfig({
        DISCORD_NOTIFICATIONS_ENABLED: "true",
        DISCORD_WEBHOOK_URL: url,
      });
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(NotificationConfigError);
    expect(captured).toMatchObject({
      code: "INVALID_DISCORD_WEBHOOK_CONFIG",
      message: "Discord webhook configuration is invalid",
    });
    if (url !== "") expect(JSON.stringify(captured)).not.toContain(url);
  });

  it("versionなしとv10の標準pathだけを許可する", () => {
    for (const url of [
      validUrl,
      "https://discord.com/api/v10/webhooks/1234567890/token.value-1",
    ]) {
      expect(
        loadNotificationConfig({
          DISCORD_NOTIFICATIONS_ENABLED: "true",
          DISCORD_WEBHOOK_URL: url,
        }).enabled,
      ).toBe(true);
    }
  });

  it("runtime bindingはcloseで有効な配送を中断する", async () => {
    const config = loadNotificationConfig({
      DISCORD_NOTIFICATIONS_ENABLED: "true",
      DISCORD_WEBHOOK_URL: validUrl,
    });
    let started = false;
    const binding = createRuntimeNotificationBinding(config, {
      transport: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          started = true;
          const signal = init.signal;
          if (!(signal instanceof AbortSignal)) {
            reject(new Error("missing signal"));
            return;
          }
          signal.addEventListener(
            "abort",
            () => reject(new Error("transport aborted")),
            { once: true },
          );
        }),
      wait: () => Promise.resolve(),
      jitter: () => 0,
    });
    const delivery = binding.port.send({
      notificationId: "state:1:test",
      sourceRevision: 1,
      type: "runtime_stopped",
      severity: "info",
      occurredAt: "2026-07-31T00:00:00.000Z",
      title: "test",
      body: "test",
    });
    const result = delivery.catch((error: unknown) => error);
    await vi.waitFor(() => expect(started).toBe(true));
    expect(binding.close()).toBeUndefined();
    await expect(result).resolves.toMatchObject({
      classification: "cancelled",
    });
  });
});
