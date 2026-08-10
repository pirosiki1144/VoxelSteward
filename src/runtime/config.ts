import { parseInteger } from "../smoke/config.js";
import { resolveMinecraftVersion } from "../smoke/minecraft-version.js";
import type { RuntimeConfig } from "./types.js";

const required = (name: string, value: string | undefined): string => {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required`);
  }
  return value.trim();
};

export const loadRuntimeConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfig => {
  if (environment.BOT_MODE !== undefined && environment.BOT_MODE !== "normal") {
    throw new Error("runtime BOT_MODE must be normal");
  }
  const logLevel = environment.LOG_LEVEL ?? "info";
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    throw new Error("LOG_LEVEL must be debug, info, warn, or error");
  }

  const reconnectInitialDelayMs = parseInteger(
    "RUNTIME_RECONNECT_INITIAL_DELAY_MS",
    environment.RUNTIME_RECONNECT_INITIAL_DELAY_MS,
    1_000,
    100,
    300_000,
  );
  const reconnectMaxDelayMs = parseInteger(
    "RUNTIME_RECONNECT_MAX_DELAY_MS",
    environment.RUNTIME_RECONNECT_MAX_DELAY_MS,
    30_000,
    reconnectInitialDelayMs,
    300_000,
  );

  const config: Omit<RuntimeConfig, "versionSource"> = {
    host: required("MINECRAFT_HOST", environment.MINECRAFT_HOST),
    port: parseInteger(
      "MINECRAFT_PORT",
      environment.MINECRAFT_PORT,
      19132,
      1,
      65_535,
    ),
    accountId: required("BOT_ACCOUNT_ID", environment.BOT_ACCOUNT_ID),
    mode: "normal",
    authProfilesFolder:
      environment.AUTH_PROFILES_FOLDER?.trim() || "/auth/profiles",
    logLevel: logLevel as RuntimeConfig["logLevel"],
    connectionTimeoutMs: parseInteger(
      "RUNTIME_CONNECTION_TIMEOUT_MS",
      environment.RUNTIME_CONNECTION_TIMEOUT_MS,
      15_000,
      1_000,
      120_000,
    ),
    maxRetries: parseInteger(
      "RUNTIME_MAX_RETRIES",
      environment.RUNTIME_MAX_RETRIES,
      3,
      0,
      20,
    ),
    reconnectInitialDelayMs,
    reconnectMaxDelayMs,
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
