export const SUPPORTED_MINECRAFT_VERSIONS = ["1.26.30", "1.26.40"] as const;

export type MinecraftVersion = (typeof SUPPORTED_MINECRAFT_VERSIONS)[number];
export type MinecraftVersionSource = "environment" | "auto";
export type MinecraftVersionErrorCode =
  "INVALID_MINECRAFT_VERSION" | "UNSUPPORTED_MINECRAFT_VERSION";

export interface MinecraftVersionSelection {
  readonly version?: MinecraftVersion;
  readonly source: MinecraftVersionSource;
  readonly configuredVersion?: MinecraftVersion;
}

export class MinecraftVersionConfigError extends Error {
  readonly code: MinecraftVersionErrorCode;
  readonly requestedVersion: string | undefined;

  constructor(code: MinecraftVersionErrorCode, requestedVersion?: string) {
    super(
      code === "INVALID_MINECRAFT_VERSION"
        ? "Minecraft version format is invalid"
        : "Minecraft version is not supported by the protocol library",
    );
    this.name = "MinecraftVersionConfigError";
    this.code = code;
    this.requestedVersion = requestedVersion;
  }
}

const canonicalVersion = (raw: string): string | undefined => {
  const full = /^1\.(\d{1,3})\.(\d{1,3})$/.exec(raw);
  if (full !== null) return `1.${Number(full[1])}.${Number(full[2])}`;
  const short = /^(\d{1,3})\.(\d{1,3})$/.exec(raw);
  if (short !== null) return `1.${Number(short[1])}.${Number(short[2])}`;
  return undefined;
};

const isSupported = (value: string): value is MinecraftVersion =>
  (SUPPORTED_MINECRAFT_VERSIONS as readonly string[]).includes(value);

export const resolveMinecraftVersion = (
  raw: string | undefined,
): MinecraftVersionSelection => {
  if (raw === undefined || raw.trim() === "") {
    return Object.freeze({ source: "auto" });
  }
  const normalized = canonicalVersion(raw.trim());
  if (normalized === undefined) {
    throw new MinecraftVersionConfigError("INVALID_MINECRAFT_VERSION");
  }
  if (!isSupported(normalized)) {
    throw new MinecraftVersionConfigError(
      "UNSUPPORTED_MINECRAFT_VERSION",
      normalized,
    );
  }
  return Object.freeze({
    version: normalized,
    configuredVersion: normalized,
    source: "environment",
  });
};

export const minecraftVersionLogFields = (selection: {
  readonly version?: MinecraftVersion;
  readonly configuredVersion?: MinecraftVersion;
  readonly versionSource: MinecraftVersionSource;
}): Readonly<{
  configuredVersion: string;
  resolvedVersion: string;
  versionSource: MinecraftVersionSource;
}> => ({
  configuredVersion: selection.configuredVersion ?? "auto",
  resolvedVersion: selection.version ?? "auto",
  versionSource: selection.versionSource,
});

export const minecraftVersionErrorLogFields = (
  error: unknown,
):
  | Readonly<{
      code: MinecraftVersionErrorCode;
      configuredVersion: string;
    }>
  | undefined => {
  if (!(error instanceof MinecraftVersionConfigError)) return undefined;
  return {
    code: error.code,
    configuredVersion: error.requestedVersion ?? "<invalid>",
  };
};
