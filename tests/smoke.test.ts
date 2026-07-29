import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/infrastructure/logger.js";
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
    const { connection, result } = setup();
    connection.emit("authenticated", "VoxelBot");
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
  });

  it("debugモードでも安全制御を維持して他プレイヤー検知時に切断する", async () => {
    const { connection, result, output } = setup("debug");
    connection.emit("authenticated", "VoxelBot");
    connection.emit("playerJoined", {
      id: "other-id",
      name: "OtherPlayer",
      detectedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(result).resolves.toMatchObject({
      reason: "other_player_detected",
    });
    expect(connection.disconnect).toHaveBeenCalledOnce();
    expect(output.join("")).toContain("minecraft.other_player_joined");
  });

  it("BOT自身は他プレイヤーとして扱わない", () => {
    const { connection } = setup();
    connection.emit("authenticated", "VoxelBot");
    connection.emit("playerJoined", {
      id: "self-id",
      name: "VoxelBot",
      detectedAt: new Date().toISOString(),
    });

    expect(connection.disconnect).not.toHaveBeenCalled();
  });

  it("タイムアウトで安全に終了する", async () => {
    vi.useFakeTimers();
    const { connection, result } = setup();
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(result).resolves.toMatchObject({ reason: "timeout" });
    expect(connection.disconnect).toHaveBeenCalledOnce();
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
    connection.emit("error", new Error("first"));
    connection.emit("error", new Error("second"));

    await expect(result).resolves.toMatchObject({
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
