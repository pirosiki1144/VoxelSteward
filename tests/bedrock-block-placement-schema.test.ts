import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { assessBedrockBlockPlacementCapability } from "../src/adapters/minecraft/bedrock-block-placement-capability.js";
import {
  BEDROCK_BLOCK_FACE_EVIDENCE,
  assessBedrockPlacementEnvelope,
  createBedrockPlacementInteractionDraft,
  createObservedDirtTransactionItem,
} from "../src/adapters/minecraft/bedrock-block-placement-protocol.js";
import { WorldObservationStore } from "../src/domain/world-observation/index.js";

interface PacketSerializer {
  createPacketBuffer(packet: {
    readonly name: string;
    readonly params: object;
  }): Buffer;
}

interface SerializerModule {
  createSerializer(version: string): PacketSerializer;
}

const require = createRequire(import.meta.url);
const serializerModule =
  require("bedrock-protocol/src/transforms/serializer.js") as SerializerModule;

// These values prove only the pinned schema shape. They are deliberately not
// exported to production code and make no claim about dirt IDs or face meaning.
const structuralItem = {
  network_id: 1,
  count: 1,
  metadata: 0,
  has_stack_id: 1,
  stack_id: 1,
  block_runtime_id: 1,
  extra: {
    has_nbt: 0,
    can_place_on: [],
    can_destroy: [],
  },
};

const transactionData = {
  action_type: "click_block",
  trigger_type: "player_input",
  block_position: { x: 0, y: 70, z: 0 },
  face: 0,
  hotbar_slot: 0,
  held_item: structuralItem,
  player_pos: { x: 0, y: 71, z: 0 },
  click_pos: { x: 0.5, y: 1, z: 0.5 },
  block_runtime_id: 1,
  client_prediction: "failure",
  client_cooldown_state: "off",
};

const playerAuthInputBase = {
  pitch: 0,
  yaw: 0,
  position: { x: 0, y: 71, z: 0 },
  move_vector: { x: 0, z: 0 },
  head_yaw: 0,
  input_data: { item_interact: true },
  input_mode: "mouse",
  play_mode: "normal",
  interaction_model: "crosshair",
  interact_rotation: { x: 0, z: 0 },
  tick: 1n,
  delta: { x: 0, y: 0, z: 0 },
  analogue_move_vector: { x: 0, z: 0 },
  camera_orientation: { x: 0, y: 0, z: 1 },
  raw_move_vector: { x: 0, z: 0 },
};

describe("Bedrock 1.26.30 block placement schema", () => {
  it("standalone inventory_transaction candidateをoffline serializeできる", () => {
    const serializer = serializerModule.createSerializer("1.26.30");
    expect(() =>
      serializer.createPacketBuffer({
        name: "inventory_transaction",
        params: {
          transaction: {
            legacy: { legacy_request_id: 0 },
            transaction_type: "item_use",
            actions: [],
            transaction_data: transactionData,
          },
        },
      }),
    ).not.toThrow();
  });

  it("PlayerAuthInput item_interact candidateもoffline serializeできる", () => {
    const serializer = serializerModule.createSerializer("1.26.30");
    expect(() =>
      serializer.createPacketBuffer({
        name: "player_auth_input",
        params: {
          ...playerAuthInputBase,
          transaction: {
            legacy: { legacy_request_id: 0 },
            actions: [],
            data: transactionData,
          },
        },
      }),
    ).not.toThrow();
  });

  it("does not infer face numbers or choose between two valid envelopes", () => {
    expect(BEDROCK_BLOCK_FACE_EVIDENCE).toEqual({
      status: "unsupported",
      reason: "reference_mapping_requires_golden_fixture_confirmation",
      allowedSemanticFace: "up",
      referenceWireValue: 1,
      referenceCommits: {
        geyser: "3aeedfa6f207691d92d4f20106bc586b2ab883d4",
        cloudburst: "97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7",
        prismarine: "1b38211b69e44ed6abee620d995e5364967c9103",
      },
    });
    for (const context of [
      {
        serverAuthoritativeInventory: false,
        movementAuthority: "client" as const,
      },
      {
        serverAuthoritativeInventory: true,
        movementAuthority: "server_with_rewind" as const,
        currentTick: 20n,
      },
    ]) {
      expect(assessBedrockPlacementEnvelope(context)).toMatchObject({
        capability: "unsupported",
        selected: undefined,
        reason: "selection_rule_absent_from_pinned_schema",
      });
    }
  });

  it("validates support/target integers and block-local click coordinates without assigning a face number", () => {
    const valid = createBedrockPlacementInteractionDraft({
      target: { x: 0, y: 71, z: 0, dimension: "overworld" },
      support: { x: 0, y: 70, z: 0, dimension: "overworld" },
      semanticFace: "up",
      clickPosition: { x: 0.5, y: 1, z: 0.5 },
      playerPosition: {
        x: 0.5,
        y: 71.62,
        z: 1.5,
        dimension: "overworld",
      },
    });
    expect(valid).toBeDefined();
    expect(Object.isFrozen(valid)).toBe(true);
    expect(
      createBedrockPlacementInteractionDraft({
        target: { x: 0, y: 71, z: 0, dimension: "overworld" },
        support: { x: 0, y: 70, z: 0, dimension: "overworld" },
        semanticFace: "up",
        clickPosition: { x: 0.5, y: 1.001, z: 0.5 },
        playerPosition: {
          x: 0.5,
          y: 71.62,
          z: 1.5,
          dimension: "overworld",
        },
      }),
    ).toBeUndefined();
    expect(
      createBedrockPlacementInteractionDraft({
        target: { x: 30_000_001, y: 71, z: 0, dimension: "overworld" },
        support: { x: 30_000_001, y: 70, z: 0, dimension: "overworld" },
        semanticFace: "up",
        clickPosition: { x: 0.5, y: 1, z: 0.5 },
        playerPosition: {
          x: 30_000_000,
          y: 71,
          z: 0,
          dimension: "overworld",
        },
      }),
    ).toBeUndefined();
    expect(
      createBedrockPlacementInteractionDraft({
        target: { x: 0, y: 71, z: 0, dimension: "overworld" },
        support: { x: 0, y: 70, z: 0, dimension: "overworld" },
        semanticFace: "up",
        clickPosition: { x: 0.5, y: 1, z: 0.5 },
        playerPosition: { x: 4, y: 71, z: 0, dimension: "overworld" },
      }),
    ).toBeUndefined();
    expect(
      createBedrockPlacementInteractionDraft({
        target: { x: 0, y: 71, z: 0, dimension: "overworld" },
        support: { x: 0, y: 70, z: 0, dimension: "overworld" },
        semanticFace: "up",
        clickPosition: { x: 0.5, y: 1, z: 0.5 },
        playerPosition: { x: 0, y: 71, z: 0, dimension: "nether" },
      }),
    ).toBeUndefined();
  });

  it("converts only exact observed dirt with safe empty transaction extra", () => {
    const store = new WorldObservationStore();
    store.dispatch({
      type: "connection_started",
      sequence: 1,
      dimension: "overworld",
    });
    store.dispatch({
      type: "item_registry_observed",
      sequence: 2,
      registry: {
        status: "ready",
        connectionGeneration: store.getSnapshot().connectionGeneration,
        itemCount: 700,
        dirt: { identifier: "minecraft:dirt", networkId: 3 },
      },
    });
    store.dispatch({
      type: "spawn_completed",
      sequence: 3,
      dimension: "overworld",
    });
    store.dispatch({
      type: "held_item_observed",
      sequence: 4,
      selectedSlot: 0,
      heldItem: {
        status: "known",
        networkId: 3,
        count: 1,
        metadata: 0,
        blockRuntimeId: 77,
        stackNetworkId: 42,
        transactionExtra: "empty",
      },
    });
    const item = createObservedDirtTransactionItem(store.getSnapshot());
    expect(item).toEqual({
      network_id: 3,
      count: 1,
      metadata: 0,
      has_stack_id: 1,
      stack_id: 42,
      block_runtime_id: 77,
      extra: {
        has_nbt: "false",
        can_place_on: [],
        can_destroy: [],
      },
    });
    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item?.extra)).toBe(true);
  });

  it("rejects mismatched dirt IDs and incomplete transaction item fields", () => {
    const base = {
      revision: 1,
      updatedAt: "2026-08-01T00:00:00.000Z",
      lastSequence: 1,
      availability: "ready" as const,
      connectionGeneration: 1,
      dimension: "overworld" as const,
      inventory: {
        selectedSlot: 0,
        inventorySlot: "unsupported" as const,
        heldItem: {
          status: "known" as const,
          networkId: 4,
          count: 1,
          metadata: 0,
          blockRuntimeId: 77,
          stackNetworkId: 42,
          transactionExtra: "empty" as const,
        },
        fullInventory: "unsupported" as const,
      },
      itemRegistry: {
        status: "ready" as const,
        connectionGeneration: 1,
        itemCount: 700,
        dirt: { identifier: "minecraft:dirt" as const, networkId: 3 },
      },
      blocks: [],
    };
    expect(createObservedDirtTransactionItem(base)).toBeUndefined();
    expect(
      createObservedDirtTransactionItem({
        ...base,
        inventory: {
          ...base.inventory,
          heldItem: {
            ...base.inventory.heldItem,
            networkId: 3,
            transactionExtra: "unsupported",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      createObservedDirtTransactionItem({
        ...base,
        inventory: {
          ...base.inventory,
          heldItem: {
            ...base.inventory.heldItem,
            networkId: 3,
            blockRuntimeId: 2_147_483_648,
          },
        },
      }),
    ).toBeUndefined();
  });

  it("schema serialize成功だけではproduction capabilityを有効化しない", () => {
    const assessment = assessBedrockBlockPlacementCapability("1.26.30");
    expect(assessment.capability).toBe("unsupported");
    expect(assessment.blockers).toEqual([
      "dirt_item_registry_mapping_unavailable",
      "held_item_transaction_shape_unavailable",
      "block_face_mapping_unproven",
      "transaction_envelope_unproven",
      "authoritative_frame_unavailable",
    ]);
    expect(Object.isFrozen(assessment)).toBe(true);
    expect(Object.isFrozen(assessment.blockers)).toBe(true);
  });

  it("runtime registry and item evidence cannot bypass unresolved face and envelope", () => {
    expect(
      assessBedrockBlockPlacementCapability("1.26.30", {
        dirtItemRegistryMapping: true,
        heldItemTransactionShape: true,
        authoritativeFrame: true,
      }),
    ).toEqual({
      capability: "unsupported",
      version: "1.26.30",
      blockers: [
        "block_face_mapping_unproven",
        "transaction_envelope_unproven",
      ],
    });
  });

  it("未固定versionを拒否する", () => {
    expect(() => assessBedrockBlockPlacementCapability("latest")).toThrowError(
      "Unsupported Bedrock block placement protocol version",
    );
  });
});
