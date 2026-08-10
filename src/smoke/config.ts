import type { BotMode, SmokeConfig } from "./types.js";
import { resolveMinecraftVersion } from "./minecraft-version.js";

export const parseBotMode = (raw: string | undefined): BotMode => {
  const mode = raw ?? "normal";
  if (mode !== "normal" && mode !== "debug") {
    throw new Error("BOT_MODE must be normal or debug");
  }
  return mode;
};

export const parseInteger = (
  name: string,
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number => {
  const value = raw === undefined || raw === "" ? defaultValue : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
};

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

export const loadSmokeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): SmokeConfig => {
  const mode = parseBotMode(environment.BOT_MODE);

  const logLevel = environment.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error");
  }

  const config: Omit<SmokeConfig, "versionSource"> = {
    host: required("MINECRAFT_HOST", environment.MINECRAFT_HOST),
    port: parseInteger(
      "MINECRAFT_PORT",
      environment.MINECRAFT_PORT,
      19132,
      1,
      65535,
    ),
    accountId: required("BOT_ACCOUNT_ID", environment.BOT_ACCOUNT_ID),
    mode,
    timeoutSeconds: parseInteger(
      "SMOKE_TIMEOUT_SECONDS",
      environment.SMOKE_TIMEOUT_SECONDS,
      60,
      5,
      300,
    ),
    authProfilesFolder:
      environment.AUTH_PROFILES_FOLDER?.trim() || "/auth/profiles",
    logLevel: logLevel as SmokeConfig["logLevel"],
    connectionTimeoutMs: 15_000,
  };

  const version = resolveMinecraftVersion(environment.MINECRAFT_VERSION);
  return {
    ...config,
    versionSource: version.source,
    ...(version.version === undefined ? {} : { version: version.version }),
    ...(version.configuredVersion === undefined
      ? {}
      : { configuredVersion: version.configuredVersion }),
  };
};
