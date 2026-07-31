import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  migrate,
  rollbackAll,
} from "../src/adapters/persistence/mysql-migrations.js";
import { MySqlStatePersistenceRepository } from "../src/adapters/persistence/mysql-state-persistence-repository.js";
import { mapStateChangeToNotification } from "../src/application/notifications/index.js";
import { createStateStore } from "../src/domain/state/index.js";

const enabled = process.env.MYSQL_INTEGRATION_TEST === "true";
const suite = enabled ? describe : describe.skip;

interface VersionRow extends RowDataPacket {
  readonly version: number;
}
interface CountRow extends RowDataPacket {
  readonly count: number;
}
interface RevisionRow extends RowDataPacket {
  readonly revision: number;
}
interface CheckpointRow extends RowDataPacket {
  readonly revision: number;
  readonly task_state: string;
}

suite("MySqlStatePersistenceRepository", () => {
  const pool = mysql.createPool({
    host: "127.0.0.1",
    port: 33060,
    database: "voxel_steward_test",
    user: "voxel_test",
    password: "voxel_test_password",
    connectionLimit: 2,
  });
  const repository = new MySqlStatePersistenceRepository(pool);

  beforeAll(async () => {
    await rollbackAll(pool);
  });

  afterAll(async () => {
    await rollbackAll(pool);
    await repository.close();
  });

  it("migrationを排他制御して並行・冪等適用できる", async () => {
    await Promise.all([migrate(pool), migrate(pool)]);
    await migrate(pool);
    const [rows] = await pool.query<VersionRow[]>(
      "SELECT version FROM schema_migrations ORDER BY version",
    );
    expect(rows).toEqual([{ version: 1 }]);
  });

  it("history、snapshot、checkpoint、outboxを同一revisionで保存し重複を抑制する", async () => {
    const runId = "00000000-0000-4000-8000-000000000002";
    await repository.initialize(runId, "2026-07-31T00:00:00.000Z");
    const store = createStateStore();
    store.dispatch({
      type: "task.prepare",
      taskId: "task-001",
      taskType: "verification",
    });
    const event = store.dispatch({ type: "task.transition", to: "running" });
    if (event === undefined) throw new Error("fixture event missing");
    const notification = mapStateChangeToNotification(event);
    await repository.persist(runId, event, notification);
    await repository.persist(runId, event, notification);

    const [history] = await pool.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM state_history WHERE run_id = ? AND revision = ?",
      [runId, event.revision],
    );
    const [snapshot] = await pool.query<RevisionRow[]>(
      "SELECT revision FROM state_snapshots WHERE run_id = ?",
      [runId],
    );
    const [checkpoint] = await pool.query<CheckpointRow[]>(
      "SELECT revision, task_state FROM task_checkpoints WHERE run_id = ? AND task_id = ?",
      [runId, "task-001"],
    );
    const [outbox] = await pool.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM notification_outbox WHERE run_id = ? AND source_revision = ?",
      [runId, event.revision],
    );
    expect(history[0]?.count).toBe(1);
    expect(snapshot).toEqual([{ revision: event.revision }]);
    expect(checkpoint).toEqual([
      { revision: event.revision, task_state: "running" },
    ]);
    expect(outbox[0]?.count).toBe(1);
  });

  it("古いrevisionで最新snapshotとcheckpointを後退させない", async () => {
    const runId = "00000000-0000-4000-8000-000000000003";
    await repository.initialize(runId, "2026-07-31T00:00:00.000Z");
    const store = createStateStore();
    const older = store.dispatch({
      type: "task.prepare",
      taskId: "task-002",
      taskType: "verification",
    });
    const newer = store.dispatch({ type: "task.transition", to: "running" });
    if (older === undefined || newer === undefined)
      throw new Error("fixture event missing");
    await repository.persist(runId, newer, mapStateChangeToNotification(newer));
    await repository.persist(runId, older, mapStateChangeToNotification(older));
    const [snapshot] = await pool.query<RevisionRow[]>(
      "SELECT revision FROM state_snapshots WHERE run_id = ?",
      [runId],
    );
    const [checkpoint] = await pool.query<RevisionRow[]>(
      "SELECT revision FROM task_checkpoints WHERE run_id = ? AND task_id = ?",
      [runId, "task-002"],
    );
    expect(snapshot[0]?.revision).toBe(newer.revision);
    expect(checkpoint[0]?.revision).toBe(newer.revision);
  });

  it("transaction失敗時に途中のhistoryを書き残さない", async () => {
    const runId = "00000000-0000-4000-8000-000000000004";
    await repository.initialize(runId, "2026-07-31T00:00:00.000Z");
    const store = createStateStore();
    store.dispatch({
      type: "runtime.transition",
      to: "connecting",
    });
    const event = store.dispatch({
      type: "minecraft.connection.transition",
      to: "connecting",
    });
    if (event === undefined) throw new Error("fixture event missing");
    const notification = mapStateChangeToNotification(event);
    if (notification === undefined)
      throw new Error("fixture notification missing");
    const invalidNotification = {
      ...notification,
      notificationId: null as unknown as string,
    };
    await expect(
      repository.persist(runId, event, invalidNotification),
    ).rejects.toMatchObject({
      code: "PERSISTENCE_FATAL",
      retryable: false,
    });
    const [history] = await pool.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM state_history WHERE run_id = ? AND revision = ?",
      [runId, event.revision],
    );
    expect(history[0]?.count).toBe(0);
  });

  it("未適用migrationのdown SQLを実行しない", async () => {
    await pool.query("DELETE FROM schema_migrations WHERE version = 1");
    await rollbackAll(pool);
    const [tables] = await pool.query<RowDataPacket[]>(
      "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'state_history'",
    );
    expect(tables).toHaveLength(1);
    await pool.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INT UNSIGNED NOT NULL PRIMARY KEY, name VARCHAR(128) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB",
    );
    await pool.execute(
      "INSERT INTO schema_migrations (version, name) VALUES (1, 'state_history')",
    );
  });
});
