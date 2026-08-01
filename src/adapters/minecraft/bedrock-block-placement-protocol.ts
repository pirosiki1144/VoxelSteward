import type {
  ObservedHeldItem,
  WorldObservationSnapshot,
} from "../../domain/world-observation/index.js";
import {
  MAX_BLOCK_REACH,
  blockDistance,
  validateBlockPosition,
  type BlockPosition,
} from "../../domain/block-operation/index.js";
import { validateMovementPosition } from "../../domain/movement/index.js";
import type { MovementPosition } from "../../domain/movement/index.js";

export const BEDROCK_BLOCK_FACE_EVIDENCE = Object.freeze({
  status: "unsupported" as const,
  reason: "reference_mapping_requires_golden_fixture_confirmation" as const,
  allowedSemanticFace: "up" as const,
  referenceWireValue: 1 as const,
  referenceCommits: Object.freeze({
    geyser: "3aeedfa6f207691d92d4f20106bc586b2ab883d4",
    cloudburst: "97fd7dce91a69e9a1f3f6bd7c1b8c790f2bbd8f7",
    prismarine: "1b38211b69e44ed6abee620d995e5364967c9103",
  }),
});

export interface BedrockPlacementInteractionDraft {
  readonly target: BlockPosition;
  readonly support: BlockPosition;
  readonly semanticFace: "up";
  readonly clickPosition: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly playerPosition: MovementPosition;
}

const finite = (value: number): boolean => Number.isFinite(value);

export const createBedrockPlacementInteractionDraft = (
  value: BedrockPlacementInteractionDraft,
): BedrockPlacementInteractionDraft | undefined => {
  const integerCoordinates = [
    value.target.x,
    value.target.y,
    value.target.z,
    value.support.x,
    value.support.y,
    value.support.z,
  ];
  const clickCoordinates = [
    value.clickPosition.x,
    value.clickPosition.y,
    value.clickPosition.z,
  ];
  const playerCoordinates = [
    value.playerPosition.x,
    value.playerPosition.y,
    value.playerPosition.z,
  ];
  try {
    validateBlockPosition(value.target);
    validateBlockPosition(value.support);
    validateMovementPosition(value.playerPosition);
  } catch {
    return undefined;
  }
  if (
    value.semanticFace !== "up" ||
    value.playerPosition.dimension !== value.target.dimension ||
    value.target.dimension !== value.support.dimension ||
    value.target.x !== value.support.x ||
    value.target.y !== value.support.y + 1 ||
    value.target.z !== value.support.z ||
    !integerCoordinates.every(Number.isSafeInteger) ||
    !clickCoordinates.every(
      (coordinate) => finite(coordinate) && coordinate >= 0 && coordinate <= 1,
    ) ||
    !playerCoordinates.every(finite) ||
    blockDistance(value.target, value.playerPosition) > MAX_BLOCK_REACH
  ) {
    return undefined;
  }
  return Object.freeze({
    target: Object.freeze({ ...value.target }),
    support: Object.freeze({ ...value.support }),
    semanticFace: "up",
    clickPosition: Object.freeze({ ...value.clickPosition }),
    playerPosition: Object.freeze({ ...value.playerPosition }),
  });
};

export interface BedrockPlacementAuthorityContext {
  readonly serverAuthoritativeInventory: boolean;
  readonly movementAuthority:
    "client" | "server" | "server_with_rewind" | "unknown";
  readonly currentTick?: bigint;
}

export interface BedrockPlacementEnvelopeAssessment {
  readonly capability: "unsupported";
  readonly candidates: readonly [
    "inventory_transaction",
    "player_auth_input_item_interact",
  ];
  readonly selected: undefined;
  readonly reason: "selection_rule_absent_from_pinned_schema";
}

/**
 * The pinned schema exposes both envelopes, but does not define the rule that
 * selects one for block placement. Authority flags must never be treated as an
 * inferred selection rule.
 */
export const assessBedrockPlacementEnvelope = (
  context: BedrockPlacementAuthorityContext,
): BedrockPlacementEnvelopeAssessment => {
  void context;
  return Object.freeze({
    capability: "unsupported",
    candidates: Object.freeze([
      "inventory_transaction",
      "player_auth_input_item_interact",
    ] as const),
    selected: undefined,
    reason: "selection_rule_absent_from_pinned_schema",
  });
};

export interface BedrockTransactionHeldItem {
  readonly network_id: number;
  readonly count: number;
  readonly metadata: number;
  readonly has_stack_id: 1;
  readonly stack_id: number;
  readonly block_runtime_id: number;
  readonly extra: {
    readonly has_nbt: "false";
    readonly can_place_on: readonly never[];
    readonly can_destroy: readonly never[];
  };
}

const usableHeldItem = (
  heldItem: ObservedHeldItem,
): heldItem is Extract<ObservedHeldItem, { status: "known" }> =>
  heldItem.status === "known" &&
  heldItem.stackNetworkId !== "unsupported" &&
  heldItem.transactionExtra === "empty" &&
  heldItem.count >= 1 &&
  heldItem.count <= 65_535 &&
  heldItem.metadata >= 0 &&
  heldItem.metadata <= 4_294_967_295 &&
  heldItem.blockRuntimeId >= 0 &&
  heldItem.blockRuntimeId <= 2_147_483_647 &&
  heldItem.stackNetworkId >= 1 &&
  heldItem.stackNetworkId <= 2_147_483_647;

/**
 * Converts only the allow-listed, fully observed ItemNew subset into the Item
 * shape required by TransactionUseItem. It does not select an envelope, face,
 * target, or transport and therefore cannot cause a packet send.
 */
export const createObservedDirtTransactionItem = (
  snapshot: WorldObservationSnapshot,
): BedrockTransactionHeldItem | undefined => {
  const heldItem = snapshot.inventory.heldItem;
  if (
    snapshot.availability !== "ready" ||
    snapshot.itemRegistry.status !== "ready" ||
    snapshot.itemRegistry.connectionGeneration !==
      snapshot.connectionGeneration ||
    !usableHeldItem(heldItem) ||
    heldItem.networkId !== snapshot.itemRegistry.dirt.networkId
  ) {
    return undefined;
  }
  const stackNetworkId = heldItem.stackNetworkId;
  if (stackNetworkId === "unsupported") return undefined;
  return Object.freeze({
    network_id: heldItem.networkId,
    count: heldItem.count,
    metadata: heldItem.metadata,
    has_stack_id: 1 as const,
    stack_id: stackNetworkId,
    block_runtime_id: heldItem.blockRuntimeId,
    extra: Object.freeze({
      has_nbt: "false" as const,
      can_place_on: Object.freeze([]),
      can_destroy: Object.freeze([]),
    }),
  });
};
