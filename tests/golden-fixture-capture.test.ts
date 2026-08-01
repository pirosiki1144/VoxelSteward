import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  DecodedPacketInputError,
  DecodedPacketStdinSource,
} from "../src/adapters/minecraft/decoded-packet-stdin-source.js";
import { runGoldenFixtureCapture } from "../src/golden-fixture-capture.js";
import type {
  DecodedPacketSource,
  GoldenFixtureOutputPort,
} from "../src/ports/golden-fixture-capture-port.js";
import {
  GoldenFixtureCaptureConfigError,
  loadGoldenFixtureCaptureConfig,
} from "../src/runtime/golden-fixture-capture-config.js";

const validEnvironment = (): NodeJS.ProcessEnv => ({
  GOLDEN_CAPTURE_MODE: "decoded_stream",
  GOLDEN_CAPTURE_MAX_FIXTURES: "1",
  GOLDEN_CAPTURE_TIMEOUT_MS: "60000",
  GOLDEN_CAPTURE_MAX_PACKETS: "10000",
  MINECRAFT_VERSION: "1.26.30",
});

describe("Golden fixture capture config", () => {
  it("requires an explicit mode, one fixture, and the pinned protocol", () => {
    expect(loadGoldenFixtureCaptureConfig(validEnvironment())).toEqual({
      mode: "decoded_stream",
      maxFixtures: 1,
      timeoutMs: 60_000,
      maxPackets: 10_000,
      protocolVersion: "1.26.30",
    });
    for (const invalid of [
      {},
      { ...validEnvironment(), GOLDEN_CAPTURE_MODE: "capture" },
      { ...validEnvironment(), GOLDEN_CAPTURE_MAX_FIXTURES: "2" },
      { ...validEnvironment(), MINECRAFT_VERSION: "latest" },
      { ...validEnvironment(), GOLDEN_CAPTURE_TIMEOUT_MS: "300001" },
      { ...validEnvironment(), GOLDEN_CAPTURE_MAX_PACKETS: "0" },
    ]) {
      expect(() => loadGoldenFixtureCaptureConfig(invalid)).toThrow(
        GoldenFixtureCaptureConfigError,
      );
    }
  });

  it("uses bounded defaults without reading endpoint or authentication config", () => {
    const config = loadGoldenFixtureCaptureConfig({
      GOLDEN_CAPTURE_MODE: "decoded_stream",
      GOLDEN_CAPTURE_MAX_FIXTURES: "1",
      MINECRAFT_VERSION: "1.26.30",
      MINECRAFT_HOST: "must-not-be-read",
      BOT_ACCOUNT_ID: "must-not-be-read",
    });
    expect(config).toMatchObject({ timeoutMs: 60_000, maxPackets: 10_000 });
    expect(JSON.stringify(config)).not.toMatch(/HOST|ACCOUNT|must-not-be-read/);
  });
});

describe("DecodedPacketStdinSource", () => {
  it("streams decoded packets, converts decimal tick, and never echoes input", async () => {
    const input = new PassThrough();
    const source = new DecodedPacketStdinSource(input);
    const listener = vi.fn();
    source.on("packet", listener);
    source.start();
    input.end(
      `${JSON.stringify({
        data: {
          name: "player_auth_input",
          params: { tick: "123", playerName: "must-not-escape" },
        },
      })}\n`,
    );
    await source.completed;
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toMatchObject({
      data: { name: "player_auth_input", params: { tick: 123n } },
    });
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("end")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
  });

  it("rejects malformed and overlong input with a fixed safe error", async () => {
    for (const payload of ["not-json\n", `${"x".repeat(256 * 1024 + 1)}\n`]) {
      const input = new PassThrough();
      const source = new DecodedPacketStdinSource(input);
      source.start();
      const rejection = expect(source.completed).rejects.toEqual(
        new DecodedPacketInputError("INVALID_DECODED_PACKET_INPUT"),
      );
      input.end(payload);
      await rejection;
      expect(input.listenerCount("data")).toBe(0);
    }
  });

  it("stops accepting packets after close", () => {
    const input = new PassThrough();
    const source = new DecodedPacketStdinSource(input);
    const listener = vi.fn();
    source.on("packet", listener);
    source.start();
    source.close();
    input.write(
      `${JSON.stringify({ data: { name: "start_game", params: {} } })}\n`,
    );
    expect(listener).not.toHaveBeenCalled();
    expect(input.listenerCount("data")).toBe(0);
  });
});

class FakeCaptureInput implements DecodedPacketSource {
  readonly completed = new Promise<void>(() => undefined);
  readonly listeners = new Set<(packet: unknown) => void>();
  startCount = 0;
  closeCount = 0;

  on(_event: "packet", listener: (packet: unknown) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "packet", listener: (packet: unknown) => void): void {
    this.listeners.delete(listener);
  }

  start(): void {
    this.startCount += 1;
    const emit = (name: string, params: unknown): void => {
      for (const listener of [...this.listeners]) {
        listener({ data: { name, params } });
      }
    };
    emit("start_game", { server_authoritative_inventory: true });
    emit("set_movement_authority", {
      movement_authority: "server_with_rewind",
    });
    emit("item_registry", {
      itemstates: [{ name: "minecraft:dirt", runtime_id: 42 }],
    });
    emit("update_block", {
      position: { x: 10, y: 70, z: 20 },
      block_runtime_id: 500,
      layer: 0,
    });
    emit("player_auth_input", {
      pitch: 0,
      yaw: 90,
      head_yaw: 90,
      position: { x: 10.5, y: 71.62, z: 21.5 },
      move_vector: { x: 0, z: 0 },
      tick: 1n,
      input_data: { item_interact: true },
      transaction: {
        actions: [
          {
            source_type: "container",
            slot: 0,
            old_item: {
              network_id: 42,
              count: 2,
              metadata: 0,
              block_runtime_id: 7,
            },
            new_item: {
              network_id: 42,
              count: 1,
              metadata: 0,
              block_runtime_id: 7,
            },
          },
        ],
        data: {
          action_type: "click_block",
          trigger_type: "player_input",
          block_position: { x: 10, y: 70, z: 20 },
          face: 1,
          hotbar_slot: 0,
          held_item: {
            network_id: 42,
            count: 2,
            metadata: 0,
            has_stack_id: true,
            stack_id: { empty: 0, id: 5 },
            block_runtime_id: 7,
            extra: {
              has_nbt: "false",
              can_place_on: [],
              can_destroy: [],
            },
          },
          player_pos: { x: 10.5, y: 71.62, z: 21.5 },
          click_pos: { x: 0.5, y: 1, z: 0.5 },
          block_runtime_id: 500,
        },
      },
    });
  }

  close(): void {
    this.closeCount += 1;
    this.listeners.clear();
  }
}

describe("golden fixture capture entrypoint", () => {
  it("uses a dedicated lock, captures once, and cleans up without reconnect", async () => {
    const input = new FakeCaptureInput();
    const output: GoldenFixtureOutputPort = {
      write: () => Promise.resolve("/tmp/golden/capture.json"),
    };
    const lock = {
      acquire: vi.fn(() => Promise.resolve()),
      release: vi.fn(() => Promise.resolve()),
    };
    await expect(
      runGoldenFixtureCapture(validEnvironment(), { input, output, lock }),
    ).resolves.toMatchObject({ outcome: "captured", exitCode: 0 });
    expect(input.startCount).toBe(1);
    expect(input.closeCount).toBe(1);
    expect(input.listeners.size).toBe(0);
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });

  it("does not acquire a lock or start input when already cancelled", async () => {
    const abort = new AbortController();
    abort.abort();
    const input = new FakeCaptureInput();
    const lock = {
      acquire: vi.fn(() => Promise.resolve()),
      release: vi.fn(() => Promise.resolve()),
    };
    await expect(
      runGoldenFixtureCapture(validEnvironment(), {
        input,
        output: { write: () => Promise.resolve("/tmp/unused") },
        lock,
        signal: abort.signal,
      }),
    ).resolves.toEqual({ outcome: "cancelled", exitCode: 1 });
    expect(lock.acquire).not.toHaveBeenCalled();
    expect(input.startCount).toBe(0);
  });

  it("releases the dedicated lock when cancellation happens during acquisition", async () => {
    const abort = new AbortController();
    const input = new FakeCaptureInput();
    const lock = {
      acquire: vi.fn(() => {
        abort.abort();
        return Promise.resolve();
      }),
      release: vi.fn(() => Promise.resolve()),
    };
    await expect(
      runGoldenFixtureCapture(validEnvironment(), {
        input,
        output: { write: () => Promise.resolve("/tmp/unused") },
        lock,
        signal: abort.signal,
      }),
    ).resolves.toEqual({ outcome: "cancelled", exitCode: 1 });
    expect(lock.release).toHaveBeenCalledTimes(1);
    expect(input.startCount).toBe(0);
  });
});
