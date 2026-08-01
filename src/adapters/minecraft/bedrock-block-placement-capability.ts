export const SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION = "1.26.30";

export type BlockPlacementCapabilityBlocker =
  | "dirt_item_registry_mapping_unavailable"
  | "held_item_transaction_shape_unavailable"
  | "block_face_mapping_unproven"
  | "transaction_envelope_unproven"
  | "authoritative_frame_unavailable";

export interface BedrockBlockPlacementRuntimeEvidence {
  readonly dirtItemRegistryMapping: boolean;
  readonly heldItemTransactionShape: boolean;
  readonly authoritativeFrame: boolean;
}

export interface BedrockBlockPlacementCapabilityAssessment {
  readonly capability: "unsupported";
  readonly version: typeof SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION;
  readonly blockers: readonly BlockPlacementCapabilityBlocker[];
}

/**
 * Reports the deliberately fail-closed production capability. The pinned
 * schema can encode candidate transaction shapes, but it does not prove the
 * server-authority envelope, numeric face semantics, or a canonical dirt item.
 */
export const assessBedrockBlockPlacementCapability = (
  version: string,
  evidence: BedrockBlockPlacementRuntimeEvidence = {
    dirtItemRegistryMapping: false,
    heldItemTransactionShape: false,
    authoritativeFrame: false,
  },
): BedrockBlockPlacementCapabilityAssessment => {
  if (version !== SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION) {
    throw new Error("Unsupported Bedrock block placement protocol version");
  }
  const blockers: BlockPlacementCapabilityBlocker[] = [];
  if (!evidence.dirtItemRegistryMapping) {
    blockers.push("dirt_item_registry_mapping_unavailable");
  }
  if (!evidence.heldItemTransactionShape) {
    blockers.push("held_item_transaction_shape_unavailable");
  }
  blockers.push("block_face_mapping_unproven");
  blockers.push("transaction_envelope_unproven");
  if (!evidence.authoritativeFrame) {
    blockers.push("authoritative_frame_unavailable");
  }
  return Object.freeze({
    capability: "unsupported",
    version,
    blockers: Object.freeze(blockers),
  });
};
