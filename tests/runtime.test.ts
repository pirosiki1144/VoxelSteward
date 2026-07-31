import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { NotificationSubscriber } from "../src/application/notifications/index.js";
import { StatePersistenceSubscriber } from "../src/application/persistence/index.js";
import {
  createStateStore,
  type StateStore,
} from "../src/domain/state/index.js";
import { createLogger } from "../src/infrastructure/logger.js";
import { loadRuntimeConfig } from "../src/runtime/config.js";
import { RuntimeSupervisor } from "../src/runtime/supervisor.js";
import type { RuntimeConfig, Wait } from "../src/runtime/types.js";
import type {
  ConnectionEvents,
  ReadonlyMinecraftConnection,
} from "../src/smoke/types.js";
import { FakeNotificationPort } from "./fakes/fake-notification-port.js";
import { FakeStatePersistenceRepository } from "./fakes/fake-state-persistence-repository.js";
import { PersistenceError } from "../src/ports/state-persistence-repository.js";

class FakeConnection
  extends EventEmitter
  implements ReadonlyMinecraftConnection
{
  disconnect = vi.fn();

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
}

const config = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => ({
  host: "test.invalid",
  port: 19132,
  accountId: "runtime-bot",
  mode: "normal",
  authProfilesFolder: "/tmp/test-auth",
  logLevel: "debug",
  connectionTimeoutMs: 15_000,
  maxRetries: 3,
  reconnectInitialDelayMs: 100,
  reconnectMaxDelayMs: 250,
  ...overrides,
});

const setup = (
  connections: FakeConnection[],
  overrides: Partial<RuntimeConfig> = {},
  wait: Wait = () => Promise.resolve(),
  stateStore: StateStore = createStateStore(),
) => {
  const output: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output.push(String(chunk));
      callback();
    },
  });
  let factoryCalls = 0;
  const supervisor = new RuntimeSupervisor(
    config(overrides),
    () => {
      const connection = connections[factoryCalls];
      factoryCalls += 1;
      if (connection === undefined) throw new Error("unexpected attempt");
      return connection;
    },
    createLogger("normal", "debug", stream),
    wait,
    stateStore,
  );
  return {
    supervisor,
    run: supervisor.run(),
    output,
    stateStore,
    factoryCalls: () => factoryCalls,
  };
};

const player = {
  id: "other-id",
  name: "OtherPlayer",
  detectedAt: "2026-01-01T00:00:00.000Z",
};

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const waitForCalls = async (
  factoryCalls: () => number,
  expected: number,
): Promise<void> => {
  for (let index = 0; index < 20; index += 1) {
    if (factoryCalls() === expected) return;
    await flush();
  }
  throw new Error(`expected ${expected} connection attempts`);
};

describe("RuntimeSupervisor", () => {
  it("永続化障害時も他プレイヤー安全切断を完了する", async () => {
    const connection = new FakeConnection();
    const stateStore = createStateStore();
    const repository = new FakeStatePersistenceRepository();
    repository.handler = () =>
      Promise.reject(new PersistenceError("PERSISTENCE_FATAL", false));
    const onError = vi.fn();
    const persistence = new StatePersistenceSubscriber(repository, "run", {
      onError,
    });
    persistence.subscribe(stateStore);
    const { run } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      stateStore,
    );
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("spawn");
    connection.emit("playerJoined", player);

    await expect(run).resolves.toEqual({
      reason: "other_player_detected",
      exitCode: 0,
    });
    await persistence.flush();
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalled();
    expect(stateStore.getSnapshot()).toMatchObject({
      runtime: "stopped",
      stopReason: "other_player_detected",
    });
    persistence.close();
  });

  it("login、spawn、signal停止をStateStore経由で順序通知する", async () => {
    const connection = new FakeConnection();
    const stateStore = createStateStore();
    const port = new FakeNotificationPort();
    const notifications = new NotificationSubscriber(port);
    notifications.subscribe(stateStore);
    const { supervisor, run } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      stateStore,
    );
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("spawn");
    supervisor.requestStop("signal_sigterm");

    await expect(run).resolves.toEqual({
      reason: "signal_sigterm",
      exitCode: 0,
    });
    await notifications.flush();
    expect(port.messages.map(({ type }) => type)).toEqual([
      "minecraft_connecting",
      "minecraft_connected",
      "minecraft_spawned",
      "stop_requested",
      "runtime_stopped",
    ]);
    notifications.close();
  });

  it("login、spawn、telemetryと正常停止を状態へ反映する", async () => {
    const connection = new FakeConnection();
    const { supervisor, run, stateStore } = setup([connection]);
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("state", {
      position: { x: 10, y: 71, z: -4 },
      health: 20,
      hunger: 18,
      playerName: "must not enter state",
    });
    connection.emit("spawn");

    expect(supervisor.getStateSnapshot()).toMatchObject({
      runtime: "ready",
      minecraft: {
        connection: "spawned",
        spawnCompleted: true,
        position: { x: 10, y: 71, z: -4 },
        health: 20,
        hunger: 18,
        otherPlayerDetected: false,
      },
    });
    expect(JSON.stringify(stateStore.getSnapshot())).not.toContain(
      "playerName",
    );

    supervisor.requestStop("stop_requested");
    await run;
    expect(stateStore.getSnapshot()).toMatchObject({
      runtime: "stopped",
      stopReason: "stop_requested",
      minecraft: {
        connection: "disconnected",
        spawnCompleted: false,
      },
    });
  });

  it("接続とスポーン後に待機状態を維持する", async () => {
    const connection = new FakeConnection();
    const { supervisor, run, output } = setup([connection]);
    connection.emit("authenticated", "VoxelStewardBOT");
    connection.emit("join");
    connection.emit("spawn");
    await flush();

    expect(output.join("")).toContain("runtime.started");
    expect(connection.disconnect).not.toHaveBeenCalled();

    supervisor.requestStop("stop_requested");
    await expect(run).resolves.toEqual({
      reason: "stop_requested",
      exitCode: 0,
    });
  });

  it("スポーン時に別プレイヤーがいると安全終了する", async () => {
    const connection = new FakeConnection();
    const { run, stateStore } = setup([connection]);
    connection.emit("authenticated", "VoxelStewardBOT");
    connection.emit("join");
    connection.emit("playerJoined", player);
    connection.emit("spawn");

    await expect(run).resolves.toEqual({
      reason: "other_player_detected",
      exitCode: 0,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(stateStore.getSnapshot()).toMatchObject({
      runtime: "stopped",
      stopReason: "other_player_detected",
      minecraft: {
        otherPlayerDetected: true,
        connection: "disconnected",
      },
    });
  });

  it("接続後の別プレイヤー参加で一度だけ安全終了する", async () => {
    const connection = new FakeConnection();
    const { run, output } = setup([connection]);
    connection.emit("authenticated", "VoxelStewardBOT");
    connection.emit("join");
    connection.emit("spawn");
    connection.emit("playerJoined", player);
    connection.emit("playerJoined", player);

    await expect(run).resolves.toMatchObject({
      reason: "other_player_detected",
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(
      output.join("").match(/minecraft\.other_player_detected/g),
    ).toHaveLength(1);
  });

  it("BOT自身は他プレイヤーとして扱わない", async () => {
    const connection = new FakeConnection();
    const { supervisor, run } = setup([connection]);
    connection.emit("authenticated", "VoxelStewardBOT");
    connection.emit("spawn");
    connection.emit("playerJoined", {
      ...player,
      id: "self-id",
      name: "VoxelStewardBOT",
    });

    expect(connection.disconnect).not.toHaveBeenCalled();
    supervisor.requestStop("stop_requested");
    await run;
  });

  it("一時的な切断後に再接続する", async () => {
    const first = new FakeConnection();
    const second = new FakeConnection();
    const { supervisor, run, factoryCalls } = setup([first, second]);
    first.emit("close");
    await waitForCalls(factoryCalls, 2);

    expect(factoryCalls()).toBe(2);
    second.emit("spawn");
    supervisor.requestStop("stop_requested");
    await run;
  });

  it("再接続開始と上限到達を状態へ反映する", async () => {
    const first = new FakeConnection();
    const second = new FakeConnection();
    const stateStore = createStateStore();
    const states: string[] = [];
    stateStore.subscribe((event) => {
      states.push(event.after.runtime);
    });
    const { run, factoryCalls } = setup(
      [first, second],
      { maxRetries: 1 },
      () => Promise.resolve(),
      stateStore,
    );
    first.emit("close");
    await waitForCalls(factoryCalls, 2);
    second.emit("close");

    await expect(run).resolves.toEqual({
      reason: "reconnect_exhausted",
      exitCode: 1,
    });
    await flush();
    expect(states).toContain("reconnecting");
    expect(stateStore.getSnapshot()).toMatchObject({
      runtime: "failed",
      stopReason: "reconnect_exhausted",
      lastError: {
        code: "reconnect_exhausted",
        message: "Reconnect attempts exhausted",
      },
    });
  });

  it("構造化された一時接続エラー後に再接続する", async () => {
    const first = new FakeConnection();
    const second = new FakeConnection();
    const { supervisor, run, factoryCalls } = setup([first, second]);
    first.emit("connectionError", {
      error: new Error("temporary network error"),
      retryable: true,
    });
    await waitForCalls(factoryCalls, 2);

    supervisor.requestStop("stop_requested");
    await run;
  });

  it("再接続待機時間を指数増加させ上限を適用する", async () => {
    const connections = [
      new FakeConnection(),
      new FakeConnection(),
      new FakeConnection(),
      new FakeConnection(),
    ];
    const delays: number[] = [];
    const { run, factoryCalls } = setup(
      connections,
      { maxRetries: 3 },
      (delayMs) => {
        delays.push(delayMs);
        return Promise.resolve();
      },
    );
    for (const [index, connection] of connections.entries()) {
      await waitForCalls(factoryCalls, index + 1);
      connection.emit("close");
    }

    await run;
    expect(delays).toEqual([100, 200, 250]);
  });

  it("最大再試行回数を超えず上限到達時に異常終了する", async () => {
    const connections = [
      new FakeConnection(),
      new FakeConnection(),
      new FakeConnection(),
    ];
    const { run, factoryCalls, output } = setup(connections, {
      maxRetries: 2,
    });
    for (const [index, connection] of connections.entries()) {
      await waitForCalls(factoryCalls, index + 1);
      connection.emit("close");
    }

    await expect(run).resolves.toEqual({
      reason: "reconnect_exhausted",
      exitCode: 1,
    });
    expect(factoryCalls()).toBe(3);
    expect(output.join("")).toContain("reconnect.exhausted");
  });

  it("再接続待機中のSIGINTで再接続しない", async () => {
    const first = new FakeConnection();
    let waitingSignal: AbortSignal | undefined;
    const wait: Wait = (_delay, signal) =>
      new Promise<void>((resolve) => {
        waitingSignal = signal;
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
    const { supervisor, run, factoryCalls } = setup([first], {}, wait);
    first.emit("close");
    await flush();
    expect(waitingSignal?.aborted).toBe(false);

    supervisor.requestStop("signal_sigint");
    await expect(run).resolves.toEqual({
      reason: "signal_sigint",
      exitCode: 0,
    });
    expect(factoryCalls()).toBe(1);
  });

  it("SIGTERMで切断しリスナーとタイマーを解放する", async () => {
    vi.useFakeTimers();
    const connection = new FakeConnection();
    const { supervisor, run, stateStore } = setup([connection]);
    supervisor.requestStop("signal_sigterm");

    await expect(run).resolves.toEqual({
      reason: "signal_sigterm",
      exitCode: 0,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(connection.eventNames()).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(stateStore.getSnapshot()).toMatchObject({
      runtime: "stopped",
      stopReason: "signal_sigterm",
    });
    vi.useRealTimers();
  });

  it("回復不能な接続エラーは再試行しない", async () => {
    const connection = new FakeConnection();
    const { run, factoryCalls } = setup([connection]);
    connection.emit("connectionError", {
      error: new Error("authentication failed"),
      retryable: false,
    });

    await expect(run).resolves.toEqual({
      reason: "connection_error",
      exitCode: 1,
    });
    expect(factoryCalls()).toBe(1);
  });

  it("一時切断、再接続、上限到達をStateStore経由で通知する", async () => {
    const first = new FakeConnection();
    const second = new FakeConnection();
    const stateStore = createStateStore();
    const port = new FakeNotificationPort();
    const notifications = new NotificationSubscriber(port);
    notifications.subscribe(stateStore);
    const { run, factoryCalls } = setup(
      [first, second],
      { maxRetries: 1 },
      () => Promise.resolve(),
      stateStore,
    );
    first.emit("close");
    await waitForCalls(factoryCalls, 2);
    second.emit("close");

    await expect(run).resolves.toEqual({
      reason: "reconnect_exhausted",
      exitCode: 1,
    });
    await notifications.flush();
    expect(port.messages.map(({ type }) => type)).toEqual([
      "minecraft_connecting",
      "minecraft_disconnected",
      "reconnect_started",
      "minecraft_connecting",
      "minecraft_disconnected",
      "reconnect_exhausted",
    ]);
    notifications.close();
  });

  it("回復不能な接続エラーをStateStore経由で通知する", async () => {
    const connection = new FakeConnection();
    const stateStore = createStateStore();
    const port = new FakeNotificationPort();
    const notifications = new NotificationSubscriber(port);
    notifications.subscribe(stateStore);
    const { run } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      stateStore,
    );
    connection.emit("connectionError", {
      error: new Error("adapter detail must not be notified"),
      retryable: false,
    });

    await expect(run).resolves.toMatchObject({
      reason: "connection_error",
      exitCode: 1,
    });
    await notifications.flush();
    expect(port.messages.map(({ type }) => type)).toEqual([
      "minecraft_connecting",
      "minecraft_disconnected",
      "runtime_failed",
    ]);
    expect(JSON.stringify(port.messages)).not.toContain(
      "adapter detail must not be notified",
    );
    notifications.close();
  });

  it("他プレイヤー検知を緊急通知し通常停止通知を重複させない", async () => {
    const connection = new FakeConnection();
    const stateStore = createStateStore();
    const port = new FakeNotificationPort();
    const notifications = new NotificationSubscriber(port);
    notifications.subscribe(stateStore);
    const { run } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      stateStore,
    );
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("spawn");
    connection.emit("playerJoined", player);

    await expect(run).resolves.toEqual({
      reason: "other_player_detected",
      exitCode: 0,
    });
    await notifications.flush();
    expect(
      port.messages.filter(({ type }) => type === "other_player_safety_stop"),
    ).toHaveLength(1);
    expect(port.messages.some(({ type }) => type === "runtime_stopped")).toBe(
      false,
    );
    expect(connection.disconnect).toHaveBeenCalledOnce();
    notifications.close();
  });

  it("通知失敗時も他プレイヤー検知の安全切断を完了する", async () => {
    const connection = new FakeConnection();
    const stateStore = createStateStore();
    const errors: unknown[] = [];
    const port = new FakeNotificationPort(() =>
      Promise.reject(new Error("notification unavailable")),
    );
    const notifications = new NotificationSubscriber(port, {
      onNotificationError: (error) => errors.push(error),
    });
    notifications.subscribe(stateStore);
    const { run } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      stateStore,
    );
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("spawn");
    connection.emit("playerJoined", player);

    await expect(run).resolves.toEqual({
      reason: "other_player_detected",
      exitCode: 0,
    });
    await notifications.flush();
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(errors.length).toBeGreaterThan(0);
    notifications.close();
  });

  it("状態dispatchが失敗しても他プレイヤー検知で安全切断する", async () => {
    const connection = new FakeConnection();
    const fallback = createStateStore();
    const failingStore: StateStore = {
      getSnapshot: () => fallback.getSnapshot(),
      dispatch: () => {
        throw new Error("state dispatch failed");
      },
      subscribe: () => () => undefined,
    };
    const { run, output } = setup(
      [connection],
      {},
      () => Promise.resolve(),
      failingStore,
    );
    connection.emit("authenticated", "runtime identity");
    connection.emit("join");
    connection.emit("spawn");
    connection.emit("playerJoined", player);

    await expect(run).resolves.toEqual({
      reason: "other_player_detected",
      exitCode: 0,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(output.join("")).toContain("runtime.state_update_failed");
  });
});

describe("runtime configuration", () => {
  const environment = {
    MINECRAFT_HOST: "test.invalid",
    BOT_ACCOUNT_ID: "runtime-bot",
  };

  it.each([
    ["BOT_MODE", "debug"],
    ["RUNTIME_MAX_RETRIES", "-1"],
    ["RUNTIME_RECONNECT_INITIAL_DELAY_MS", "99"],
    ["RUNTIME_RECONNECT_MAX_DELAY_MS", "99"],
    ["RUNTIME_CONNECTION_TIMEOUT_MS", "999"],
  ])("不正な%sを拒否する", (name, value) => {
    expect(() =>
      loadRuntimeConfig({ ...environment, [name]: value }),
    ).toThrow();
  });
});
