import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/infrastructure/logger.js";
import { parseBotMode } from "../src/smoke/config.js";
import { SmokeSession } from "../src/smoke/session.js";
import type {
  ConnectionEvents,
  ReadonlyMinecraftConnection,
  SmokeConfig,
} from "../src/smoke/types.js";

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

const config = (mode: "normal" | "debug" = "normal"): SmokeConfig => ({
  host: "test.invalid",
  port: 19132,
  accountId: "test-bot",
  mode,
  timeoutSeconds: 60,
  authProfilesFolder: "/tmp/test-auth",
  logLevel: "debug",
});

const setup = (mode: "normal" | "debug" = "normal") => {
  const output: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      output.push(String(chunk));
      callback();
    },
  });
  const connection = new FakeConnection();
  const session = new SmokeSession(
    connection,
    config(mode),
    createLogger(mode, "debug", stream),
  );
  const result = session.run();
  return { connection, session, result, output };
};

afterEach(() => {
  vi.useRealTimers();
});

describe("SmokeSession", () => {
  it("normalモードでは他プレイヤーを検知すると切断する", async () => {
    const { connection, result, output } = setup();
    connection.emit("authenticated", "VoxelBot");
    connection.emit("spawn");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: new Date().toISOString(),
    });

    await expect(result).resolves.toMatchObject({
      reason: "other_player_detected",
      exitCode: 0,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(output.join("")).toContain("minecraft.other_player_joined");
  });

  it("debugモードでは他プレイヤーを記録して接続を維持する", () => {
    const { connection, output } = setup("debug");
    connection.emit("authenticated", "VoxelBot");
    connection.emit("spawn");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(output.join("")).toContain("minecraft.other_player_joined");
    expect(output.join("")).toContain("minecraft.other_player_allowed");
    expect(output.join("")).toContain("connection_continued");
  });

  it("debugモードでは他プレイヤーが退出しても接続を維持する", () => {
    const { connection, output } = setup("debug");
    connection.emit("authenticated", "VoxelBot");
    connection.emit("spawn");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
    connection.emit("playerLeft", {
      id: "other-id",
      detectedAt: "2026-01-01T00:01:00.000Z",
    });

    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(output.join("")).toContain("minecraft.other_player_left");
  });

  it("BOT自身は他プレイヤーとして扱わない", () => {
    const { connection } = setup();
    connection.emit("authenticated", "VoxelBot");
    connection.emit("spawn");
    connection.emit("playerJoined", {
      id: "self-id",
      name: "VoxelBot",
      detectedAt: new Date().toISOString(),
    });

    expect(connection.disconnect).not.toHaveBeenCalled();
  });

  it("normalではスポーン時点の他プレイヤーを検知して切断する", async () => {
    const { connection, result } = setup();
    connection.emit("authenticated", "VoxelBot");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(connection.disconnect).not.toHaveBeenCalled();
    connection.emit("spawn");

    await expect(result).resolves.toMatchObject({
      reason: "other_player_detected",
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("debugではスポーン時点の他プレイヤーを記録して接続を維持する", () => {
    const { connection, output } = setup("debug");
    connection.emit("authenticated", "VoxelBot");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });
    connection.emit("spawn");

    expect(connection.disconnect).not.toHaveBeenCalled();
    expect(output.join("")).toContain("minecraft.other_player_allowed");
  });

  it("重複した参加イベントでも停止と切断は一度だけ実行する", async () => {
    const { connection, result, output } = setup();
    connection.emit("authenticated", "VoxelBot");
    connection.emit("spawn");
    const player = {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    };
    connection.emit("playerJoined", player);
    connection.emit("playerJoined", player);

    await expect(result).resolves.toMatchObject({
      reason: "other_player_detected",
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(
      output.join("").match(/minecraft\.other_player_joined/g),
    ).toHaveLength(1);
  });

  it("debugでもタイムアウトで安全に終了する", async () => {
    vi.useFakeTimers();
    const { connection, result } = setup("debug");
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(result).resolves.toMatchObject({ reason: "timeout" });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(connection.eventNames()).toHaveLength(0);
  });

  it.each(["signal_sigint", "signal_sigterm"] as const)(
    "%sで安全に終了する",
    async (reason) => {
      const { connection, session, result } = setup();
      session.requestStop(reason);

      await expect(result).resolves.toMatchObject({ reason });
      expect(connection.disconnect).toHaveBeenCalledOnce();
    },
  );

  it("複数のエラーでも終了処理は一度だけ実行する", async () => {
    const { connection, result } = setup();
    connection.emit("connectionError", new Error("first"));
    connection.emit("connectionError", new Error("second"));

    await expect(result).resolves.toMatchObject({
      reason: "connection_error",
      exitCode: 1,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("接続失敗時に再試行せず異常終了する", async () => {
    const { connection, result } = setup();
    connection.emit("connectionError", new Error("connect failed"));

    await expect(result).resolves.toEqual({
      reason: "connection_error",
      exitCode: 1,
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
  });

  it("ログから秘密情報と完全な接続先をマスクする", () => {
    const output: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      },
    });
    createLogger("normal", "debug", stream).log("error", {
      event: "test",
      token: "very-secret-token",
      error: "connect failed at example.com:19132",
    });

    const log = output.join("");
    expect(log).not.toContain("very-secret-token");
    expect(log).not.toContain("example.com");
    expect(log).toContain("[REDACTED]");
    expect(log).toContain("[REDACTED_ENDPOINT]");
  });
});

describe("BOT_MODE configuration", () => {
  it("未指定時はnormalになる", () => {
    expect(parseBotMode(undefined)).toBe("normal");
  });

  it("未知の値を拒否する", () => {
    expect(() => parseBotMode("unsafe")).toThrow(
      "BOT_MODE must be normal or debug",
    );
  });
});
