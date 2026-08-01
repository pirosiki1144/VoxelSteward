import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import { assessBedrockBlockPlacementCapability } from "../src/adapters/minecraft/bedrock-block-placement-capability.js";

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

  it("未固定versionを拒否する", () => {
    expect(() => assessBedrockBlockPlacementCapability("latest")).toThrowError(
      "Unsupported Bedrock block placement protocol version",
    );
  });
});
