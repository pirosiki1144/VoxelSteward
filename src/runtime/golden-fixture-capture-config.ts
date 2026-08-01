export interface GoldenFixtureCaptureConfig {
  readonly mode: "decoded_stream";
  readonly protocolVersion: "1.26.30";
  readonly maxFixtures: 1;
  readonly timeoutMs: number;
  readonly maxPackets: number;
}

export class GoldenFixtureCaptureConfigError extends Error {
  readonly code = "INVALID_GOLDEN_CAPTURE_CONFIG";

  constructor() {
    super("Golden fixture capture configuration is invalid");
    this.name = "GoldenFixtureCaptureConfigError";
  }
}

const integer = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number => {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw new GoldenFixtureCaptureConfigError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new GoldenFixtureCaptureConfigError();
  }
  return parsed;
};

export const loadGoldenFixtureCaptureConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): GoldenFixtureCaptureConfig => {
  if (
    environment.GOLDEN_CAPTURE_MODE !== "decoded_stream" ||
    environment.MINECRAFT_VERSION !== "1.26.30" ||
    environment.GOLDEN_CAPTURE_MAX_FIXTURES !== "1"
  ) {
    throw new GoldenFixtureCaptureConfigError();
  }
  return Object.freeze({
    mode: "decoded_stream" as const,
    protocolVersion: "1.26.30" as const,
    maxFixtures: 1 as const,
    timeoutMs: integer(
      environment.GOLDEN_CAPTURE_TIMEOUT_MS,
      60_000,
      1,
      300_000,
    ),
    maxPackets: integer(
      environment.GOLDEN_CAPTURE_MAX_PACKETS,
      10_000,
      1,
      100_000,
    ),
  });
};
