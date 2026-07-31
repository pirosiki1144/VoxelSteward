import { readFile } from "node:fs/promises";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

interface MigrationRow extends RowDataPacket {
  readonly version: number;
}

interface LockRow extends RowDataPacket {
  readonly acquired: number | null;
}

interface TableRow extends RowDataPacket {
  readonly present: string;
}

const migrationLock = "voxel_steward_schema_migrations";

interface Migration {
  readonly version: number;
  readonly name: string;
  readonly up: URL;
  readonly down: URL;
}

const migrations: readonly Migration[] = [
  {
    version: 1,
    name: "state_history",
    up: new URL("./migrations/001_state_history.sql", import.meta.url),
    down: new URL("./migrations/001_state_history.down.sql", import.meta.url),
  },
];

const statements = (sql: string): readonly string[] =>
  sql
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

const executeFile = async (
  connection: PoolConnection,
  url: URL,
): Promise<void> => {
  for (const statement of statements(await readFile(url, "utf8"))) {
    await connection.query(statement);
  }
};

export const migrate = async (pool: Pool): Promise<void> => {
  const connection = await pool.getConnection();
  try {
    const [lockRows] = await connection.query<LockRow[]>(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [migrationLock],
    );
    if (lockRows[0]?.acquired !== 1)
      throw new Error("Migration lock unavailable");
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT UNSIGNED NOT NULL PRIMARY KEY,
        name VARCHAR(128) NOT NULL,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB`,
    );
    for (const migration of migrations) {
      const [rows] = await connection.query<MigrationRow[]>(
        "SELECT version FROM schema_migrations WHERE version = ?",
        [migration.version],
      );
      if (rows.length !== 0) continue;
      await executeFile(connection, migration.up);
      await connection.execute(
        `INSERT INTO schema_migrations (version, name) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name)`,
        [migration.version, migration.name],
      );
    }
  } finally {
    await connection
      .query("SELECT RELEASE_LOCK(?)", [migrationLock])
      .catch(() => undefined);
    connection.release();
  }
};

export const rollbackAll = async (pool: Pool): Promise<void> => {
  const connection = await pool.getConnection();
  try {
    const [lockRows] = await connection.query<LockRow[]>(
      "SELECT GET_LOCK(?, 10) AS acquired",
      [migrationLock],
    );
    if (lockRows[0]?.acquired !== 1)
      throw new Error("Migration lock unavailable");
    const [tables] = await connection.query<TableRow[]>(
      "SELECT TABLE_NAME AS present FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'",
    );
    if (tables.length === 0) return;
    const [applied] = await connection.query<MigrationRow[]>(
      "SELECT version FROM schema_migrations",
    );
    const versions = new Set(applied.map(({ version }) => version));
    for (const migration of [...migrations].reverse()) {
      if (!versions.has(migration.version)) continue;
      await executeFile(connection, migration.down);
      await connection.execute(
        "DELETE FROM schema_migrations WHERE version = ?",
        [migration.version],
      );
    }
    await connection.query("DROP TABLE IF EXISTS schema_migrations");
  } finally {
    await connection
      .query("SELECT RELEASE_LOCK(?)", [migrationLock])
      .catch(() => undefined);
    connection.release();
  }
};
