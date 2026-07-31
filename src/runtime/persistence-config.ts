export type PersistenceConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly host: string;
      readonly port: number;
      readonly database: string;
      readonly user: string;
      readonly password: string;
      readonly connectionTimeoutMs: number;
    };

export class InvalidPersistenceConfigError extends Error {
  override readonly name = "InvalidPersistenceConfigError";
  readonly code = "INVALID_MYSQL_PERSISTENCE_CONFIG";

  constructor() {
    super("MySQL persistence configuration is invalid");
  }
}

const required = (value: string | undefined): string => {
  if (value === undefined || value.trim() === "")
    throw new InvalidPersistenceConfigError();
  return value;
};

const integer = (
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number => {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new InvalidPersistenceConfigError();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidPersistenceConfigError();
  }
  return parsed;
};

export const loadPersistenceConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): PersistenceConfig => {
  const enabled = environment.MYSQL_PERSISTENCE_ENABLED;
  if (enabled === undefined || enabled === "false") return { enabled: false };
  if (enabled !== "true") throw new InvalidPersistenceConfigError();
  return {
    enabled: true,
    host: required(environment.MYSQL_HOST),
    port: integer(environment.MYSQL_PORT, 3306, 1, 65_535),
    database: required(environment.MYSQL_DATABASE),
    user: required(environment.MYSQL_USER),
    password: required(environment.MYSQL_PASSWORD),
    connectionTimeoutMs: integer(
      environment.MYSQL_CONNECTION_TIMEOUT_MS,
      5_000,
      100,
      120_000,
    ),
  };
};
