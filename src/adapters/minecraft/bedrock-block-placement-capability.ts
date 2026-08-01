export const SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION = "1.26.30";

export type BlockPlacementCapabilityBlocker =
  | "dirt_item_registry_mapping_unavailable"
  | "held_item_transaction_shape_unavailable"
  | "block_face_mapping_unproven"
  | "transaction_envelope_unproven"
  | "authoritative_frame_unavailable";

export interface BedrockBlockPlacementCapabilityAssessment {
  readonly capability: "unsupported";
  readonly version: typeof SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION;
  readonly blockers: readonly BlockPlacementCapabilityBlocker[];
}

const blockers = Object.freeze([
  "dirt_item_registry_mapping_unavailable",
  "held_item_transaction_shape_unavailable",
  "block_face_mapping_unproven",
  "transaction_envelope_unproven",
  "authoritative_frame_unavailable",
] satisfies readonly BlockPlacementCapabilityBlocker[]);

/**
 * Reports the deliberately fail-closed production capability. The pinned
 * schema can encode candidate transaction shapes, but it does not prove the
 * server-authority envelope, numeric face semantics, or a canonical dirt item.
 */
export const assessBedrockBlockPlacementCapability = (
  version: string,
): BedrockBlockPlacementCapabilityAssessment => {
  if (version !== SUPPORTED_BLOCK_PLACEMENT_SCHEMA_VERSION) {
    throw new Error("Unsupported Bedrock block placement protocol version");
  }
  return Object.freeze({
    capability: "unsupported",
    version,
    blockers,
  });
};
