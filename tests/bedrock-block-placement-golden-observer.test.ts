import { describe, expect, it } from "vitest";

import { BedrockBlockPlacementGoldenObserver } from "../src/adapters/minecraft/bedrock-block-placement-golden-observer.js";

const candidate = () => ({
  protocolVersion: "1.26.30" as const,
  envelope: "player_auth_input_item_interact" as const,
  authority: {
    serverAuthoritativeInventory: true,
    movementAuthority: "server_with_rewind" as const,
  },
  tick: 998_877n,
  face: 1,
  support: { x: 1234, y: 70, z: -4321 },
  clickPosition: { x: 0.5, y: 1, z: 0.5 },
  playerPosition: { x: 1234.5, y: 71.62, z: -4319.5 },
  rotation: { pitch: 15, yaw: 180, headYaw: 180 },
  hotbarSlot: 0,
  heldItem: {
    matchesObservedDirtRegistry: true,
    count: 1,
    metadata: 0,
    hasStackId: true,
    blockRuntimeIdMatchesSupportObservation: true,
    transactionExtraIsEmpty: true,
  },
  actions: {
    count: 2,
    sourcesAllowlisted: true,
    slotMatchesHeldItem: true,
    oldItemMatchesHeldItem: true,
    newItemCountDelta: -1,
  },
});

describe("BedrockBlockPlacementGoldenObserver", () => {
  it("absolute coordinates, tick, and item IDs are not retained", () => {
    const fixture = new BedrockBlockPlacementGoldenObserver().capture(
      candidate(),
    );
    expect(fixture).toMatchObject({
      schemaVersion: 1,
      protocolVersion: "1.26.30",
      tickOffset: "0",
      face: 1,
      supportOrigin: { x: 0, y: 0, z: 0 },
      playerOffset: { x: 0.5, y: 1.62, z: 1.5 },
    });
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toContain("998877");
    expect(serialized).not.toContain("1234");
    expect(serialized).not.toContain("-4321");
    expect(serialized).not.toMatch(
      /"(?:networkId|stackId|blockRuntimeId|playerName|serverAddress|serverPort)"\s*:/,
    );
  });

  it("deep-freezes the anonymized fixture", () => {
    const fixture = new BedrockBlockPlacementGoldenObserver().capture(
      candidate(),
    );
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(Object.isFrozen(fixture.authority)).toBe(true);
    expect(Object.isFrozen(fixture.supportOrigin)).toBe(true);
    expect(Object.isFrozen(fixture.playerOffset)).toBe(true);
    expect(Object.isFrozen(fixture.rotation)).toBe(true);
    expect(Object.isFrozen(fixture.heldItem)).toBe(true);
    expect(Object.isFrozen(fixture.actions)).toBe(true);
  });

  it("rejects unknown fields so identity or endpoint data cannot pass through", () => {
    const observer = new BedrockBlockPlacementGoldenObserver();
    expect(() =>
      observer.capture({ ...candidate(), playerName: "forbidden" }),
    ).toThrow("Golden block placement observation is invalid");
    expect(() =>
      new BedrockBlockPlacementGoldenObserver().capture({
        ...candidate(),
        heldItem: { ...candidate().heldItem, rawNbt: {} },
      }),
    ).toThrow("Golden block placement observation is invalid");
  });

  it("rejects invalid ranges and non-finite values", () => {
    for (const invalid of [
      { ...candidate(), face: 256 },
      { ...candidate(), hotbarSlot: 9 },
      { ...candidate(), tick: -1n },
      {
        ...candidate(),
        clickPosition: { x: Number.NaN, y: 1, z: 0.5 },
      },
      {
        ...candidate(),
        clickPosition: { x: 0.5, y: 1.01, z: 0.5 },
      },
      {
        ...candidate(),
        rotation: { ...candidate().rotation, pitch: 91 },
      },
      {
        ...candidate(),
        actions: { ...candidate().actions, newItemCountDelta: -2 },
      },
    ]) {
      expect(() =>
        new BedrockBlockPlacementGoldenObserver().capture(invalid),
      ).toThrow("Golden block placement observation is invalid");
    }
  });

  it("captures at most once and rejects after close", () => {
    const observer = new BedrockBlockPlacementGoldenObserver();
    observer.capture(candidate());
    expect(() => observer.capture(candidate())).toThrow(
      "Golden block placement observer is unavailable",
    );

    const closed = new BedrockBlockPlacementGoldenObserver();
    closed.close();
    expect(() => closed.capture(candidate())).toThrow(
      "Golden block placement observer is unavailable",
    );
  });
});
