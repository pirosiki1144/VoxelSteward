import mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  migrate,
  rollbackAll,
} from "../src/adapters/persistence/mysql-migrations.js";
import { MySqlStatePersistenceRepository } from "../src/adapters/persistence/mysql-state-persistence-repository.js";
import { MySqlOperationalLogRepository } from "../src/adapters/persistence/mysql-operational-log-repository.js";
import { MySqlNotificationOutboxRepository } from "../src/adapters/persistence/mysql-notification-outbox-repository.js";
import { MySqlTaskQueueRepository } from "../src/adapters/persistence/mysql-task-queue-repository.js";
import { TaskQueueService } from "../src/application/task-queue/index.js";
import { SafetyControlledTaskQueue } from "../src/application/safety/index.js";
import { ReadonlyTaskExecutor } from "../src/application/task-executor/index.js";
import { StatePersistenceSubscriber } from "../src/application/persistence/index.js";
import { mapStateChangeToNotification } from "../src/application/notifications/index.js";
import { createStateStore } from "../src/domain/state/index.js";
import { DefaultWorkSafetyPolicy } from "../src/domain/safety/index.js";
import type { PlaceSingleBlockInstruction } from "../src/domain/block-operation/index.js";
import { taskRecoveryDisposition } from "../src/domain/task-queue/index.js";

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
interface OutboxDeliveryRow extends RowDataPacket {
  readonly delivery_status: string;
  readonly delivery_attempts: number;
  readonly last_error_code: string | null;
}
interface RuntimeTraceRow extends RowDataPacket {
  readonly revision: number;
  readonly cause: string;
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
  const operationalLog = new MySqlOperationalLogRepository(pool);
  const queueRepository = new MySqlTaskQueueRepository(pool);
  const outboxRepository = new MySqlNotificationOutboxRepository(pool);

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
    expect(rows).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
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

  it("通常runtime相当の接続から安全停止までをrevision順に一貫保存する", async () => {
    const runId = "00000000-0000-4000-8000-000000000030";
    await repository.initialize(runId, "2026-08-01T00:00:00.000Z");
    const store = createStateStore();
    const subscriber = new StatePersistenceSubscriber(repository, runId);
    subscriber.subscribe(store);
    store.dispatch({ type: "runtime.transition", to: "connecting" });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "connecting",
    });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "connected",
    });
    store.dispatch({ type: "minecraft.spawn.update", completed: true });
    store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: {
        position: { x: 0, y: 64, z: 0 },
        dimension: "overworld",
        health: 20,
        hunger: 20,
      },
    });
    store.dispatch({
      type: "task.prepare",
      taskId: "runtime-trace",
      taskType: "verification",
    });
    store.dispatch({ type: "task.transition", to: "running" });
    store.dispatch({
      type: "runtime.stop_reason.record",
      reason: "stop_requested",
    });
    store.dispatch({ type: "task.transition", to: "stopped" });
    store.dispatch({ type: "runtime.transition", to: "stopping" });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "disconnected",
    });
    store.dispatch({ type: "runtime.transition", to: "stopped" });
    await subscriber.flush();
    subscriber.close();

    const [history] = await pool.query<RuntimeTraceRow[]>(
      `SELECT revision, cause FROM state_history
       WHERE run_id = ? ORDER BY revision`,
      [runId],
    );
    expect(history.map(({ revision }) => revision)).toEqual(
      Array.from({ length: history.length }, (_, index) => index + 1),
    );
    expect(history.map(({ cause }) => cause)).toEqual([
      "runtime.transition",
      "minecraft.connection.transition",
      "minecraft.connection.transition",
      "minecraft.spawn.update",
      "minecraft.telemetry.update",
      "task.prepare",
      "task.transition",
      "runtime.stop_reason.record",
      "task.transition",
      "runtime.transition",
      "minecraft.connection.transition",
      "runtime.transition",
    ]);
    const [snapshots] = await pool.query<RevisionRow[]>(
      "SELECT revision FROM state_snapshots WHERE run_id = ?",
      [runId],
    );
    const [checkpoints] = await pool.query<CheckpointRow[]>(
      `SELECT revision, task_state FROM task_checkpoints
       WHERE run_id = ? AND task_id = ?`,
      [runId, "runtime-trace"],
    );
    const [outbox] = await pool.query<RevisionRow[]>(
      `SELECT source_revision AS revision FROM notification_outbox
       WHERE run_id = ? ORDER BY source_revision`,
      [runId],
    );
    expect(snapshots).toEqual([{ revision: 12 }]);
    expect(checkpoints).toEqual([{ revision: 12, task_state: "stopped" }]);
    expect(outbox.map(({ revision }) => revision)).toEqual(
      [...outbox.map(({ revision }) => revision)].sort((a, b) => a - b),
    );
    expect(outbox.length).toBeGreaterThan(0);

    const status = await operationalLog.findRun(runId);
    expect(status).toMatchObject({
      runId,
      revision: 12,
      runtime: "stopped",
      minecraftConnection: "disconnected",
      spawnCompleted: false,
      telemetryStatus: "unknown",
      stopReason: "stop_requested",
      task: {
        id: "runtime-trace",
        type: "verification",
        state: "stopped",
      },
    });
    const safeHistory = await operationalLog.listHistory(runId, 0, 100);
    expect(safeHistory.map(({ revision }) => revision)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(safeHistory.map(({ cause }) => cause)).toEqual(
      history.map(({ cause }) => cause),
    );
    expect(
      safeHistory.find(({ cause }) => cause === "minecraft.telemetry.update"),
    ).toMatchObject({
      telemetryStatus: "valid",
      position: { x: 0, y: 64, z: 0 },
      dimension: "overworld",
      health: 20,
      hunger: 20,
    });
    const safeCheckpoints = await operationalLog.listCheckpoints(runId, 10);
    expect(safeCheckpoints).toEqual([
      expect.objectContaining({
        taskId: "runtime-trace",
        revision: 12,
        taskType: "verification",
        taskState: "stopped",
      }),
    ]);
    expect(
      (await operationalLog.listRuns(100)).some(
        ({ runId: id }) => id === runId,
      ),
    ).toBe(true);
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
    await migrate(pool);
  });

  it("task queueを優先度付きFIFOで永続claimし重複enqueueを抑制する", async () => {
    const times = [
      "2026-08-01T00:00:00.000Z",
      "2026-08-01T00:00:01.000Z",
      "2026-08-01T00:00:02.000Z",
      "2026-08-01T00:00:03.000Z",
    ];
    let index = 0;
    const queue = new TaskQueueService(
      queueRepository,
      () => new Date(times[Math.min(index++, times.length - 1)]!),
    );
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-low",
        taskType: "verification",
        priority: 1,
        maxAttempts: 2,
      },
    });
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-high",
        taskType: "verification",
        priority: 10,
        maxAttempts: 2,
      },
    });
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-high",
        taskType: "ignored-duplicate",
        priority: 99,
        maxAttempts: 9,
      },
    });
    const claimed = await queue.dispatch({ type: "task.claim_next" });
    expect(claimed.item).toMatchObject({
      taskId: "mysql-high",
      taskType: "verification",
      priority: 10,
      attempts: 1,
      status: "claimed",
    });
  });

  it("読み取り専用指示を冪等保存し対象typeだけをlease付きclaimする", async () => {
    const queue = new TaskQueueService(queueRepository);
    const instruction = {
      taskId: "mysql-record-position",
      taskType: "record_position" as const,
      priority: 90,
      maxAttempts: 2,
      details: {
        version: 1 as const,
        kind: "record_position" as const,
        instruction: {
          taskId: "mysql-record-position",
          taskType: "record_position" as const,
        },
      },
    };
    await queue.dispatch({ type: "task.enqueue", instruction });
    await queue.dispatch({ type: "task.enqueue", instruction });
    const claimed = await queue.dispatch({
      type: "task.claim_next",
      allowedTaskTypes: ["record_position"],
      claimOwner: "integration-worker",
      leaseDurationMs: 30_000,
    });
    expect(claimed.item).toMatchObject({
      taskId: instruction.taskId,
      status: "claimed",
      attempts: 1,
      details: instruction.details,
    });
    expect(
      await queueRepository.recoverExpiredClaims("2999-01-01T00:00:00.000Z"),
    ).toBeGreaterThanOrEqual(1);
    expect(
      taskRecoveryDisposition((await queue.find(instruction.taskId))!),
    ).toBe("manual_review");
  });

  it("読み取り専用executorの完了結果と位置checkpointを一貫保存する", async () => {
    const runId = "00000000-0000-4000-8000-000000000031";
    await repository.initialize(runId, "2026-08-01T01:00:00.000Z");
    const store = createStateStore();
    store.dispatch({ type: "runtime.transition", to: "connecting" });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "connecting",
    });
    store.dispatch({
      type: "minecraft.connection.transition",
      to: "connected",
    });
    store.dispatch({ type: "minecraft.spawn.update", completed: true });
    store.dispatch({ type: "runtime.transition", to: "ready" });
    store.dispatch({
      type: "minecraft.telemetry.update",
      telemetry: {
        position: { x: 4, y: 71, z: 8 },
        dimension: "overworld",
        health: 20,
        hunger: 20,
      },
    });
    const subscriber = new StatePersistenceSubscriber(repository, runId);
    subscriber.subscribe(store);
    const queue = new TaskQueueService(queueRepository);
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-executor-record",
        taskType: "record_position",
        priority: 95,
        maxAttempts: 1,
        details: {
          version: 1,
          kind: "record_position",
          instruction: {
            taskId: "mysql-executor-record",
            taskType: "record_position",
          },
        },
      },
    });
    const executor = new ReadonlyTaskExecutor({
      queue,
      safeQueue: new SafetyControlledTaskQueue(
        queue,
        store,
        new DefaultWorkSafetyPolicy(),
      ),
      stateStore: store,
    });
    expect(await executor.processNext()).toBe(true);
    await subscriber.flush();
    subscriber.close();
    await executor.close();
    expect((await queue.find("mysql-executor-record"))?.status).toBe(
      "completed",
    );
    const [checkpoints] = await pool.query<CheckpointRow[]>(
      `SELECT revision, task_state FROM task_checkpoints
       WHERE run_id = ? AND task_id = ?`,
      [runId, "mysql-executor-record"],
    );
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.task_state).toBe("completed");
    const [snapshots] = await pool.query<RevisionRow[]>(
      "SELECT revision FROM state_snapshots WHERE run_id = ?",
      [runId],
    );
    expect(snapshots[0]?.revision).toBe(checkpoints[0]?.revision);
  });

  it("並行claimで同じtaskを二重取得しない", async () => {
    const queue = new TaskQueueService(queueRepository);
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-concurrent",
        taskType: "verification",
        priority: 100,
        maxAttempts: 2,
      },
    });
    const claims = await Promise.all([
      queue.dispatch({ type: "task.claim_next" }),
      queue.dispatch({ type: "task.claim_next" }),
    ]);
    const ids = claims.flatMap(({ item }) =>
      item?.taskId === "mysql-concurrent" ? [item.taskId] : [],
    );
    expect(ids).toEqual(["mysql-concurrent"]);
  });

  it("task queueの再キューを試行上限でfailedへ終端化する", async () => {
    const queue = new TaskQueueService(queueRepository);
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: "mysql-bounded",
        taskType: "verification",
        priority: 100,
        maxAttempts: 1,
      },
    });
    const claimed = await queue.dispatch({ type: "task.claim_next" });
    expect(claimed.item?.taskId).toBe("mysql-bounded");
    const released = await queue.dispatch({
      type: "task.release",
      taskId: "mysql-bounded",
    });
    expect(released.item).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("単一block指示を完全復元しclaimedを再起動後に再claimしない", async () => {
    const operation: PlaceSingleBlockInstruction = {
      schemaVersion: 1,
      taskId: "mysql-place-one",
      taskType: "place_single_dirt",
      operation: "place",
      target: { x: 1, y: 71, z: 0, dimension: "overworld" },
      blockType: "dirt",
      expectedBefore: "air",
      expectedAfter: "dirt",
      support: {
        position: { x: 1, y: 70, z: 0, dimension: "overworld" },
        expected: "solid",
        face: "up",
      },
      maxReach: 3,
      timeoutMs: 5_000,
    };
    const queue = new TaskQueueService(queueRepository);
    await queue.dispatch({
      type: "task.enqueue",
      instruction: {
        taskId: operation.taskId,
        taskType: operation.taskType,
        priority: 50,
        maxAttempts: 1,
        details: {
          version: 1,
          kind: "place_single_dirt",
          instruction: operation,
        },
      },
    });
    const claimed = (await queue.dispatch({ type: "task.claim_next" })).item;
    expect(claimed?.details?.instruction).toEqual(operation);
    expect(
      claimed === undefined ? undefined : taskRecoveryDisposition(claimed),
    ).toBe("manual_review");
    const concurrent = await Promise.allSettled([
      queue.dispatch({
        type: "task.mark_delivery_started",
        taskId: operation.taskId,
      }),
      new TaskQueueService(queueRepository).dispatch({
        type: "task.mark_delivery_started",
        taskId: operation.taskId,
      }),
    ]);
    expect(
      concurrent.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      concurrent.filter(({ status }) => status === "rejected"),
    ).toHaveLength(1);
    const restarted = new TaskQueueService(queueRepository);
    const next = await restarted.dispatch({ type: "task.claim_next" });
    expect(next.item?.taskId).not.toBe(operation.taskId);
  });

  it("未知instruction versionを復元せずfail-closedにする", async () => {
    const now = new Date("2026-08-01T00:00:00.000Z");
    await pool.execute(
      `INSERT INTO task_queue
       (task_id, task_type, priority, status, attempts, max_attempts,
        instruction_version, instruction_json, execution_phase, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "mysql-invalid-version",
        "place_single_dirt",
        1,
        "queued",
        0,
        1,
        99,
        JSON.stringify({ version: 99 }),
        "not_started",
        now,
        now,
      ],
    );
    await expect(
      queueRepository.find("mysql-invalid-version"),
    ).rejects.toMatchObject({ code: "INVALID_PERSISTED_TASK_INSTRUCTION" });
  });

  it("outboxを複数workerから排他的claimし配送成功を冪等に確定する", async () => {
    await pool.query("DELETE FROM notification_outbox");
    const runId = "00000000-0000-4000-8000-000000000020";
    await repository.initialize(runId, "2026-08-01T00:00:00.000Z");
    const store = createStateStore();
    store.dispatch({
      type: "task.prepare",
      taskId: "outbox-concurrent",
      taskType: "verification",
    });
    const event = store.dispatch({ type: "task.transition", to: "running" });
    if (event === undefined) throw new Error("fixture event missing");
    await repository.persist(runId, event, mapStateChangeToNotification(event));
    const claims = await Promise.all([
      outboxRepository.claimNext(
        "worker-a",
        "2026-08-01T00:01:00.000Z",
        30_000,
        5,
      ),
      outboxRepository.claimNext(
        "worker-b",
        "2026-08-01T00:01:00.000Z",
        30_000,
        5,
      ),
    ]);
    const claimed = claims.filter((item) => item !== undefined);
    expect(claimed).toHaveLength(1);
    const item = claimed[0];
    if (item === undefined) throw new Error("fixture claim missing");
    const owner = item.leaseOwner;
    if (owner === undefined) throw new Error("fixture lease owner missing");
    await expect(
      outboxRepository.markDelivered(item, owner, "2026-08-01T00:01:01.000Z"),
    ).resolves.toBe(true);
    await expect(
      outboxRepository.markDelivered(item, owner, "2026-08-01T00:01:01.000Z"),
    ).resolves.toBe(false);
  });

  it("outbox leaseを回収し再試行上限でfailedへ終端化する", async () => {
    await pool.query("DELETE FROM notification_outbox");
    const runId = "00000000-0000-4000-8000-000000000021";
    await repository.initialize(runId, "2026-08-01T00:00:00.000Z");
    const store = createStateStore();
    store.dispatch({
      type: "task.prepare",
      taskId: "outbox-bounded",
      taskType: "verification",
    });
    const event = store.dispatch({ type: "task.transition", to: "running" });
    if (event === undefined) throw new Error("fixture event missing");
    await repository.persist(runId, event, mapStateChangeToNotification(event));
    const first = await outboxRepository.claimNext(
      "worker-a",
      "2026-08-01T00:01:00.000Z",
      1_000,
      2,
    );
    const reclaimed = await outboxRepository.claimNext(
      "worker-b",
      "2026-08-01T00:01:01.000Z",
      1_000,
      2,
    );
    if (first === undefined || reclaimed === undefined)
      throw new Error("fixture claim missing");
    expect(reclaimed.attempts).toBe(2);
    await expect(
      outboxRepository.markDelivered(
        first,
        "worker-a",
        "2026-08-01T00:01:01.000Z",
      ),
    ).resolves.toBe(false);
    await expect(
      outboxRepository.markFailed(
        reclaimed,
        "worker-b",
        "2026-08-01T00:01:01.000Z",
        undefined,
        "DELIVERY_FAILED",
      ),
    ).resolves.toBe("failed");
    const [rows] = await pool.query<OutboxDeliveryRow[]>(
      `SELECT delivery_status, delivery_attempts, last_error_code
       FROM notification_outbox WHERE run_id = ? AND notification_id = ?`,
      [runId, reclaimed.notificationId],
    );
    expect(rows).toEqual([
      {
        delivery_status: "failed",
        delivery_attempts: 2,
        last_error_code: "DELIVERY_FAILED",
      },
    ]);
  });
});
