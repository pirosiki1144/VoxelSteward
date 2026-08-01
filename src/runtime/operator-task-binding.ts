import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

import { migrate } from "../adapters/persistence/mysql-migrations.js";
import { MySqlTaskQueueRepository } from "../adapters/persistence/mysql-task-queue-repository.js";
import type { TaskQueueRepository } from "../ports/task-queue-repository.js";
import type { PersistenceConfig } from "./persistence-config.js";

export class OperatorTaskBindingError extends Error {
  override readonly name = "OperatorTaskBindingError";
  readonly code = "OPERATOR_TASK_DATABASE_UNAVAILABLE";
  constructor() {
    super("Operator task database is unavailable");
  }
}

export interface OperatorTaskBinding {
  readonly repository: TaskQueueRepository;
  close(): Promise<void>;
}

export const createOperatorTaskBinding = async (
  config: PersistenceConfig,
  createPool: (
    options: Parameters<typeof mysql.createPool>[0],
  ) => Pool = mysql.createPool,
): Promise<OperatorTaskBinding> => {
  if (!config.enabled) throw new OperatorTaskBindingError();
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
  try {
    await migrate(pool);
    return {
      repository: new MySqlTaskQueueRepository(pool),
      close: () => pool.end(),
    };
  } catch {
    await pool.end().catch(() => undefined);
    throw new OperatorTaskBindingError();
  }
};
