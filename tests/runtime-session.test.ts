import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "../src/infrastructure/logger.js";
import {
  createLockedRuntimeSession,
  createRuntimeSession,
} from "../src/runtime/session.js";
import type { RuntimeConfig } from "../src/runtime/types.js";
import type {
  ConnectionEvents,
  ReadonlyMinecraftConnection,
} from "../src/smoke/types.js";

class FakeConnection
  extends EventEmitter
  implements ReadonlyMinecraftConnection
{
  readonly disconnectReasons: string[] = [];
  override on<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this {
    return super.on(event, listener);
  }
  override off<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this {
    return super.off(event, listener);
  }
  disconnect(reason: string): void {
    this.disconnectReasons.push(reason);
  }
}

const logger = () =>
  createLogger(
    "normal",
    "error",
    new Writable({ write: (_chunk, _encoding, done) => done() }),
  );

const config = (folder: string): RuntimeConfig => ({
  host: "test.invalid",
  port: 19132,
  accountId: "scheduled-test",
  mode: "normal",
  authProfilesFolder: folder,
  logLevel: "error",
  connectionTimeoutMs: 1_000,
  maxRetries: 0,
  reconnectInitialDelayMs: 100,
  reconnectMaxDelayMs: 100,
});

describe("runtime session", () => {
  it("schedule intent、接続、停止理由を同じStateStoreへ記録して安全終了する", async () => {
    const connection = new FakeConnection();
    const session = await createRuntimeSession({
      config: config("/tmp/unused-session-lock"),
      notificationConfig: { enabled: false },
      persistenceConfig: { enabled: false },
      logger: logger(),
      createConnection: () => connection,
    });
    session.recordScheduleIntent(
      {
        type: "schedule.start_requested",
        evaluatedAt: "2026-08-06T00:00:00.000Z",
        window: {
          id: "2026-08-06:morning",
          slot: "morning",
          startsAt: "2026-08-06T00:00:00.000Z",
          endsAt: "2026-08-06T02:59:00.000Z",
        },
      },
      "morning",
    );
    const run = session.run();
    connection.emit("join");
    connection.emit("spawn");
    session.requestStop("schedule_window_ended");
    await expect(run).resolves.toEqual({
      reason: "schedule_window_ended",
      exitCode: 0,
    });
    expect(session.stateStore.getSnapshot()).toMatchObject({
      runtime: "stopped",
      stopReason: "schedule_window_ended",
      schedule: {
        intent: "schedule.start_requested",
        window: { id: "2026-08-06:morning" },
      },
    });
    expect(connection.disconnectReasons).toEqual(["schedule_window_ended"]);
    await session.close();
    await session.close();
  });

  it("同じBOT identityのscheduled sessionをInstanceLockで重複作成しない", async () => {
    const folder = await mkdtemp(path.join(tmpdir(), "voxel-schedule-lock-"));
    const options = {
      config: config(folder),
      notificationConfig: { enabled: false } as const,
      persistenceConfig: { enabled: false } as const,
      logger: logger(),
      createConnection: () => new FakeConnection(),
    };
    const first = await createLockedRuntimeSession(options);
    try {
      await expect(createLockedRuntimeSession(options)).rejects.toThrow(
        "another bot instance is active",
      );
    } finally {
      await first.close();
      await rm(folder, { recursive: true, force: true });
    }
  });
});
