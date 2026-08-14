import mysql from "mysql2/promise";
import { cpSync } from "node:fs";
import process from "node:process";

import {
  migrate,
  rollbackAll,
} from "../dist/src/adapters/persistence/mysql-migrations.js";
import { MySqlStatePersistenceRepository } from "../dist/src/adapters/persistence/mysql-state-persistence-repository.js";
import { StatePersistenceSubscriber } from "../dist/src/application/persistence/index.js";
import { createStateStore } from "../dist/src/domain/state/index.js";

const pool = mysql.createPool({
  host: "127.0.0.1",
  port: Number(process.env.MYSQL_EVALUATION_PORT ?? 33061),
  database: "voxel_steward_evaluation",
  user: "voxel_evaluation",
  password: "voxel_evaluation_password",
  connectionLimit: 2,
});
cpSync(
  "src/adapters/persistence/migrations",
  "dist/src/adapters/persistence/migrations",
  { recursive: true },
);
const runId = "00000000-0000-4000-8000-000000000032";
const repository = new MySqlStatePersistenceRepository(pool);

try {
  await migrate(pool);
  await repository.initialize(runId, "2026-08-11T00:00:00.000Z");
  const store = createStateStore();
  const subscriber = new StatePersistenceSubscriber(repository, runId);
  subscriber.subscribe(store);
  store.dispatch({ type: "runtime.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connecting" });
  store.dispatch({ type: "minecraft.connection.transition", to: "connected" });
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
    type: "runtime.stop_reason.record",
    reason: "signal_sigterm",
  });
  store.dispatch({ type: "runtime.transition", to: "stopping" });
  store.dispatch({
    type: "minecraft.connection.transition",
    to: "disconnected",
  });
  store.dispatch({ type: "runtime.transition", to: "stopped" });
  await subscriber.flush();
  subscriber.close();
  const [rows] = await pool.query(
    "SELECT COUNT(*) AS count FROM state_history WHERE run_id = ?",
    [runId],
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count < 8)
    throw new Error("evaluation persistence history is incomplete");
  process.stdout.write(
    `${JSON.stringify({ event: "evaluation.mysql_verified", historyRows: count })}\n`,
  );
} finally {
  await rollbackAll(pool).catch(() => undefined);
  await repository.close();
}
