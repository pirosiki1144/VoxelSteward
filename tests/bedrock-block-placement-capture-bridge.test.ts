import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BedrockBlockPlacementCaptureBridge,
  GoldenFixtureCaptureError,
} from "../src/adapters/minecraft/bedrock-block-placement-capture-bridge.js";
import {
  GoldenFixtureTemporaryOutput,
  serializeSafeGoldenFixture,
} from "../src/adapters/minecraft/golden-fixture-temporary-output.js";
import type { AnonymizedGoldenPlacementFixture } from "../src/adapters/minecraft/bedrock-block-placement-golden-observer.js";
import type {
  DecodedPacketSource,
  GoldenFixtureOutputPort,
} from "../src/ports/golden-fixture-capture-port.js";

class FakePacketSource implements DecodedPacketSource {
  readonly listeners = new Set<(packet: unknown) => void>();

  on(_event: "packet", listener: (packet: unknown) => void): void {
    this.listeners.add(listener);
  }

  off(_event: "packet", listener: (packet: unknown) => void): void {
    this.listeners.delete(listener);
  }

  emit(name: string, params: unknown): void {
    for (const listener of [...this.listeners]) {
      listener({
        data: {
          name,
          params,
          playerName: "must-not-escape",
          serverAddress: "must-not-escape",
        },
      });
    }
  }
}

class FakeOutput implements GoldenFixtureOutputPort {
  readonly fixtures: AnonymizedGoldenPlacementFixture[] = [];

  write(fixture: AnonymizedGoldenPlacementFixture): Promise<string> {
    this.fixtures.push(fixture);
    return Promise.resolve(
      "/tmp/voxel-steward-golden-fixtures/block-placement-golden.json",
    );
  }
}

const heldItem = {
  network_id: 42,
  count: 3,
  metadata: 0,
  has_stack_id: true,
  stack_id: { empty: 0, id: 99 },
  block_runtime_id: 7,
  extra: { has_nbt: "false", can_place_on: [], can_destroy: [] },
};

const oldItem = {
  network_id: 42,
  count: 3,
  metadata: 0,
  block_runtime_id: 7,
  net_id_variant: { type: "item_stack_net_id", id: 99 },
  extra_data: Buffer.alloc(0),
};

const transactionData = {
  action_type: "click_block",
  trigger_type: "player_input",
  block_position: { x: 100, y: 70, z: -200 },
  face: 1,
  hotbar_slot: 0,
  held_item: heldItem,
  player_pos: { x: 100.5, y: 71.62, z: -198.5 },
  click_pos: { x: 0.5, y: 1, z: 0.5 },
  block_runtime_id: 500,
  client_prediction: "success",
  client_cooldown_state: "off",
};

const actions = [
  {
    source_type: "container",
    slot: 0,
    old_item: oldItem,
    new_item: { ...oldItem, count: 2 },
  },
];

const frame = (transaction?: unknown) => ({
  pitch: 12,
  yaw: 90,
  head_yaw: 90,
  position: { x: 100.5, y: 71.62, z: -198.5 },
  move_vector: { x: 0, z: 0 },
  tick: 1234n,
  input_data: { item_interact: transaction !== undefined },
  ...(transaction === undefined ? {} : { transaction }),
});

const prepare = (source: FakePacketSource): void => {
  source.emit("start_game", {
    server_authoritative_inventory: true,
    world_name: "must-not-escape",
  });
  source.emit("set_movement_authority", {
    movement_authority: "server_with_rewind",
  });
  source.emit("item_registry", {
    itemstates: [
      { name: "minecraft:dirt", runtime_id: 42 },
      { name: "minecraft:stone", runtime_id: 43 },
    ],
  });
  source.emit("update_block", {
    position: { x: 100, y: 70, z: -200 },
    block_runtime_id: 500,
    layer: 0,
  });
};

describe("BedrockBlockPlacementCaptureBridge", () => {
  it("projects an embedded PlayerAuthInput interaction and automatically closes", async () => {
    const source = new FakePacketSource();
    const output = new FakeOutput();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output,
      version: "1.26.30",
    });
    prepare(source);
    source.emit("player_auth_input", frame({ actions, data: transactionData }));

    const result = await bridge.result;
    expect(result.fixture).toMatchObject({
      envelope: "player_auth_input_item_interact",
      authority: {
        serverAuthoritativeInventory: true,
        movementAuthority: "server_with_rewind",
      },
      supportOrigin: { x: 0, y: 0, z: 0 },
      playerOffset: { x: 0.5, y: 1.62, z: 1.5 },
      heldItem: {
        matchesObservedDirtRegistry: true,
        blockRuntimeIdMatchesSupportObservation: true,
      },
      actions: {
        count: 1,
        sourcesAllowlisted: true,
        slotMatchesHeldItem: true,
        oldItemMatchesHeldItem: true,
        newItemCountDelta: -1,
      },
    });
    expect(source.listeners.size).toBe(0);
    expect(output.fixtures).toHaveLength(1);
    expect(JSON.stringify(result.fixture)).not.toContain("must-not-escape");
    source.emit("player_auth_input", frame({ actions, data: transactionData }));
    expect(output.fixtures).toHaveLength(1);
  });

  it("projects a standalone transaction using the latest authoritative frame", async () => {
    const source = new FakePacketSource();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output: new FakeOutput(),
      version: "1.26.30",
    });
    prepare(source);
    source.emit("player_auth_input", frame());
    source.emit("inventory_transaction", {
      transaction: {
        transaction_type: "item_use",
        actions,
        transaction_data: transactionData,
      },
    });
    await expect(bridge.result).resolves.toMatchObject({
      fixture: { envelope: "inventory_transaction" },
    });
    expect(source.listeners.size).toBe(0);
  });

  it("records registry and server block match results without retaining IDs", async () => {
    const source = new FakePacketSource();
    const output = new FakeOutput();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output,
      version: "1.26.30",
    });
    prepare(source);
    source.emit(
      "player_auth_input",
      frame({
        actions,
        data: { ...transactionData, block_runtime_id: 501 },
      }),
    );
    await expect(bridge.result).resolves.toMatchObject({
      fixture: {
        heldItem: { blockRuntimeIdMatchesSupportObservation: false },
      },
    });
    const serialized = JSON.stringify(output.fixtures);
    expect(serialized).not.toMatch(/"(?:networkId|blockRuntimeId)"\s*:/);
  });

  it("times out and removes its listener", async () => {
    vi.useFakeTimers();
    try {
      const source = new FakePacketSource();
      const bridge = new BedrockBlockPlacementCaptureBridge({
        source,
        output: new FakeOutput(),
        version: "1.26.30",
        timeoutMs: 10,
      });
      const rejection = expect(bridge.result).rejects.toMatchObject({
        code: "CAPTURE_TIMEOUT",
      });
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
      expect(source.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes at the packet limit and rejects an explicit close", async () => {
    const source = new FakePacketSource();
    const limited = new BedrockBlockPlacementCaptureBridge({
      source,
      output: new FakeOutput(),
      version: "1.26.30",
      maxPackets: 1,
    });
    source.emit("unknown", {});
    source.emit("unknown", {});
    await expect(limited.result).rejects.toMatchObject({
      code: "CAPTURE_PACKET_LIMIT",
    });
    expect(source.listeners.size).toBe(0);

    const closed = new BedrockBlockPlacementCaptureBridge({
      source,
      output: new FakeOutput(),
      version: "1.26.30",
    });
    closed.close();
    await expect(closed.result).rejects.toBeInstanceOf(
      GoldenFixtureCaptureError,
    );
  });

  it("rejects output failure without leaking the underlying error", async () => {
    const source = new FakePacketSource();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output: {
        write: () => Promise.reject(new Error("secret transport detail")),
      },
      version: "1.26.30",
    });
    prepare(source);
    source.emit("player_auth_input", frame({ actions, data: transactionData }));
    await expect(bridge.result).rejects.toEqual(
      new GoldenFixtureCaptureError("CAPTURE_OUTPUT_FAILED"),
    );
  });
});

describe("Golden fixture temporary output", () => {
  it("serializes the fixed safe shape and refuses non-temporary paths", async () => {
    const source = new FakePacketSource();
    const output = new FakeOutput();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output,
      version: "1.26.30",
    });
    prepare(source);
    source.emit("player_auth_input", frame({ actions, data: transactionData }));
    const { fixture } = await bridge.result;
    expect(serializeSafeGoldenFixture(fixture)).not.toMatch(
      /must-not-escape|https?:\/\//,
    );
    expect(() => new GoldenFixtureTemporaryOutput(process.cwd())).toThrow(
      "Golden fixture output must use temporary storage",
    );
  });

  it("writes the inspected fixture with private permissions under temporary storage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "voxel-steward-test-"));
    try {
      const source = new FakePacketSource();
      const bridge = new BedrockBlockPlacementCaptureBridge({
        source,
        output: new GoldenFixtureTemporaryOutput(directory),
        version: "1.26.30",
      });
      prepare(source);
      source.emit(
        "player_auth_input",
        frame({ actions, data: transactionData }),
      );
      const result = await bridge.result;
      expect(result.outputLocation.startsWith(`${directory}/`)).toBe(true);
      const content = await readFile(result.outputLocation, "utf8");
      expect(JSON.parse(content)).toEqual(result.fixture);
      expect((await stat(result.outputLocation)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects forbidden keys before writing", async () => {
    const source = new FakePacketSource();
    const bridge = new BedrockBlockPlacementCaptureBridge({
      source,
      output: new FakeOutput(),
      version: "1.26.30",
    });
    prepare(source);
    source.emit("player_auth_input", frame({ actions, data: transactionData }));
    const { fixture } = await bridge.result;
    const unsafeFixture = { ...fixture, playerName: "must-not-write" };
    expect(() => serializeSafeGoldenFixture(unsafeFixture)).toThrow(
      "Golden fixture failed secret inspection",
    );
  });
});
