import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

import { MySqlOperationalLogRepository } from "../adapters/persistence/mysql-operational-log-repository.js";
import type { OperationalLogRepository } from "../ports/operational-log-repository.js";
import type { PersistenceConfig } from "./persistence-config.js";

export class OperatorLogBindingError extends Error {
  override readonly name = "OperatorLogBindingError";
  readonly code = "OPERATOR_LOG_DATABASE_UNAVAILABLE";
  constructor() {
    super("Operator log database is unavailable");
  }
}

export interface OperatorLogBinding {
  readonly repository: OperationalLogRepository;
  close(): Promise<void>;
}

export const createOperatorLogBinding = (
  config: PersistenceConfig,
  createPool: (
    options: Parameters<typeof mysql.createPool>[0],
  ) => Pool = mysql.createPool,
): OperatorLogBinding => {
  if (!config.enabled) throw new OperatorLogBindingError();
  const pool = createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    connectTimeout: config.connectionTimeoutMs,
    connectionLimit: 1,
    decimalNumbers: true,
    timezone: "Z",
  });
  return {
    repository: new MySqlOperationalLogRepository(pool),
    close: () => pool.end(),
  };
};
