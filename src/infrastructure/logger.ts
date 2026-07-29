export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  event: string;
  [key: string]: unknown;
}

export interface Logger {
  log(level: LogLevel, record: LogRecord): void;
}

const levels: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const sensitiveKey =
  /(?:^|_)(?:token|password|secret|authorization|cookie|xuid|user_code|device_code)(?:$|_)/i;
const connectionPattern =
  /https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}:\d{1,5}|(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?/gi;
const microsoftDeviceLogin =
  /^https:\/\/(?:www\.)?microsoft\.com\/link(?:\?.*)?$/i;

const redactValue = (key: string, value: unknown): unknown => {
  if (sensitiveKey.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (key === "verificationUri" && microsoftDeviceLogin.test(value)) {
      return value;
    }
    return value.replace(connectionPattern, "[REDACTED_ENDPOINT]");
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue("", item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childKey, childValue),
      ]),
    );
  }
  return value;
};

export const redactRecord = (record: LogRecord): LogRecord =>
  redactValue("", record) as LogRecord;

export const createLogger = (
  mode: "normal" | "debug",
  minimumLevel: LogLevel,
  output: NodeJS.WritableStream = process.stdout,
): Logger => ({
  log(level, record) {
    if (levels[level] < levels[minimumLevel]) return;
    output.write(
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        mode,
        ...redactRecord(record),
      })}\n`,
    );
  },
});
