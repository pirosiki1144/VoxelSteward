export type NotificationConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly webhookUrl: URL;
      readonly requestTimeoutMs: 5_000;
      readonly maxAttempts: 3;
      readonly totalBudgetMs: 15_000;
    };

export class NotificationConfigError extends Error {
  readonly code = "INVALID_DISCORD_WEBHOOK_CONFIG";

  constructor() {
    super("Discord webhook configuration is invalid");
    this.name = "NotificationConfigError";
  }
}

const invalidConfig = (): never => {
  throw new NotificationConfigError();
};

const parseWebhookUrl = (raw: string | undefined): URL => {
  if (raw === undefined || raw === "") return invalidConfig();
  const rawUrl = raw;

  const url = (() => {
    try {
      return new URL(rawUrl);
    } catch {
      return invalidConfig();
    }
  })();

  if (
    url.protocol !== "https:" ||
    url.hostname !== "discord.com" ||
    !rawUrl.startsWith("https://discord.com/") ||
    rawUrl.includes("?") ||
    rawUrl.includes("#") ||
    url.href !== rawUrl ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.hash !== "" ||
    url.search !== ""
  ) {
    return invalidConfig();
  }

  const segments = url.pathname.split("/");
  const unversioned =
    segments.length === 5 &&
    segments[0] === "" &&
    segments[1] === "api" &&
    segments[2] === "webhooks";
  const versioned =
    segments.length === 6 &&
    segments[0] === "" &&
    segments[1] === "api" &&
    segments[2] === "v10" &&
    segments[3] === "webhooks";
  if (!unversioned && !versioned) return invalidConfig();

  const id = segments.at(-2);
  const token = segments.at(-1);
  if (
    id === undefined ||
    !/^\d+$/.test(id) ||
    token === undefined ||
    !/^[A-Za-z0-9._-]+$/.test(token)
  ) {
    return invalidConfig();
  }

  return url;
};

export const loadNotificationConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): NotificationConfig => {
  const enabled = environment.DISCORD_NOTIFICATIONS_ENABLED;
  if (enabled === undefined || enabled === "false") {
    return Object.freeze({ enabled: false });
  }
  if (enabled !== "true") invalidConfig();

  return Object.freeze({
    enabled: true,
    webhookUrl: parseWebhookUrl(environment.DISCORD_WEBHOOK_URL),
    requestTimeoutMs: 5_000,
    maxAttempts: 3,
    totalBudgetMs: 15_000,
  });
};
