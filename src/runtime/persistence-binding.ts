import { randomUUID } from "node:crypto";

import mysql from "mysql2/promise";
import type { Pool } from "mysql2/promise";

import { MySqlStatePersistenceRepository } from "../adapters/persistence/mysql-state-persistence-repository.js";
import { MySqlNotificationOutboxRepository } from "../adapters/persistence/mysql-notification-outbox-repository.js";
import { MySqlTaskQueueRepository } from "../adapters/persistence/mysql-task-queue-repository.js";
import { migrate } from "../adapters/persistence/mysql-migrations.js";
import type { StatePersistenceRepository } from "../ports/state-persistence-repository.js";
import type { NotificationOutboxRepository } from "../ports/notification-outbox-repository.js";
import type { TaskQueueRepository } from "../ports/task-queue-repository.js";
import { PersistenceError } from "../ports/state-persistence-repository.js";
import type { PersistenceConfig } from "./persistence-config.js";

class NoopStatePersistenceRepository implements StatePersistenceRepository {
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  persist(): Promise<void> {
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export interface RuntimePersistenceBinding {
  readonly enabled: boolean;
  readonly runId: string;
  readonly repository: StatePersistenceRepository;
  readonly outboxRepository?: NotificationOutboxRepository;
  readonly taskQueueRepository?: TaskQueueRepository;
  close(): Promise<void>;
}

export const createRuntimePersistenceBinding = async (
  config: PersistenceConfig,
  startedAt = new Date().toISOString(),
  createPool: (
    options: Parameters<typeof mysql.createPool>[0],
  ) => Pool = mysql.createPool,
): Promise<RuntimePersistenceBinding> => {
  const runId = randomUUID();
  if (!config.enabled) {
    const repository = new NoopStatePersistenceRepository();
    return {
      enabled: false,
      runId,
      repository,
      close: () => repository.close(),
    };
  }
  let repository: MySqlStatePersistenceRepository | undefined;
  let pool: Pool | undefined;
  try {
    pool = createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      connectTimeout: config.connectionTimeoutMs,
      connectionLimit: 2,
      decimalNumbers: true,
      timezone: "Z",
    });
    repository = new MySqlStatePersistenceRepository(pool);
    await migrate(pool);
    await repository.initialize(runId, startedAt);
  } catch (error) {
    await repository?.close().catch(() => undefined);
    if (error instanceof PersistenceError) throw error;
    throw new PersistenceError("PERSISTENCE_FATAL", false);
  }
  if (repository === undefined || pool === undefined)
    throw new PersistenceError("PERSISTENCE_FATAL", false);
  return {
    enabled: true,
    runId,
    repository,
    outboxRepository: new MySqlNotificationOutboxRepository(pool),
    taskQueueRepository: new MySqlTaskQueueRepository(pool),
    close: () => repository.close(),
  };
};
