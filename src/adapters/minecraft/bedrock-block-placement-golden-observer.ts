const PROTOCOL_VERSION = "1.26.30" as const;
const MAX_HOTBAR_SLOT = 8;
const MAX_HORIZONTAL_WORLD_COORDINATE = 30_000_000;
const MAX_CAPTURE_OFFSET = 16;

export interface GoldenPlacementCaptureCandidate {
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly envelope:
    "inventory_transaction" | "player_auth_input_item_interact";
  readonly authority: {
    readonly serverAuthoritativeInventory: boolean;
    readonly movementAuthority: "client" | "server" | "server_with_rewind";
  };
  readonly tick: bigint;
  readonly face: number;
  readonly support: Readonly<{ x: number; y: number; z: number }>;
  readonly clickPosition: Readonly<{ x: number; y: number; z: number }>;
  readonly playerPosition: Readonly<{ x: number; y: number; z: number }>;
  readonly rotation: Readonly<{
    pitch: number;
    yaw: number;
    headYaw: number;
  }>;
  readonly hotbarSlot: number;
  readonly heldItem: Readonly<{
    matchesObservedDirtRegistry: boolean;
    count: number;
    metadata: number;
    hasStackId: boolean;
    blockRuntimeIdMatchesSupportObservation: boolean;
    transactionExtraIsEmpty: boolean;
  }>;
  readonly actions: Readonly<{
    count: number;
    sourcesAllowlisted: boolean;
    slotMatchesHeldItem: boolean;
    oldItemMatchesHeldItem: boolean;
    newItemCountDelta: number;
  }>;
}

export interface AnonymizedGoldenPlacementFixture {
  readonly schemaVersion: 1;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly envelope: GoldenPlacementCaptureCandidate["envelope"];
  readonly authority: GoldenPlacementCaptureCandidate["authority"];
  readonly tickOffset: "0";
  readonly face: number;
  readonly supportOrigin: Readonly<{ x: 0; y: 0; z: 0 }>;
  readonly clickPosition: GoldenPlacementCaptureCandidate["clickPosition"];
  readonly playerOffset: Readonly<{ x: number; y: number; z: number }>;
  readonly rotation: GoldenPlacementCaptureCandidate["rotation"];
  readonly hotbarSlot: number;
  readonly heldItem: GoldenPlacementCaptureCandidate["heldItem"];
  readonly actions: GoldenPlacementCaptureCandidate["actions"];
}

const exactKeys = (value: object, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const integer = (value: unknown): value is number =>
  finite(value) && Number.isSafeInteger(value);

const vector = (
  value: unknown,
  integerOnly: boolean,
): value is {
  x: number;
  y: number;
  z: number;
} =>
  record(value) &&
  exactKeys(value, ["x", "y", "z"]) &&
  (integerOnly ? integer(value.x) : finite(value.x)) &&
  (integerOnly ? integer(value.y) : finite(value.y)) &&
  (integerOnly ? integer(value.z) : finite(value.z));

const boolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

const normalizeOffset = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const parseCandidate = (
  value: unknown,
): GoldenPlacementCaptureCandidate | undefined => {
  if (
    !record(value) ||
    !exactKeys(value, [
      "protocolVersion",
      "envelope",
      "authority",
      "tick",
      "face",
      "support",
      "clickPosition",
      "playerPosition",
      "rotation",
      "hotbarSlot",
      "heldItem",
      "actions",
    ]) ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    (value.envelope !== "inventory_transaction" &&
      value.envelope !== "player_auth_input_item_interact") ||
    typeof value.tick !== "bigint" ||
    value.tick < 0n ||
    !integer(value.face) ||
    value.face < 0 ||
    value.face > 255 ||
    !vector(value.support, true) ||
    !vector(value.clickPosition, false) ||
    !vector(value.playerPosition, false) ||
    !integer(value.hotbarSlot) ||
    value.hotbarSlot < 0 ||
    value.hotbarSlot > MAX_HOTBAR_SLOT ||
    !record(value.authority) ||
    !exactKeys(value.authority, [
      "serverAuthoritativeInventory",
      "movementAuthority",
    ]) ||
    !boolean(value.authority.serverAuthoritativeInventory) ||
    (value.authority.movementAuthority !== "client" &&
      value.authority.movementAuthority !== "server" &&
      value.authority.movementAuthority !== "server_with_rewind") ||
    !record(value.rotation) ||
    !exactKeys(value.rotation, ["pitch", "yaw", "headYaw"]) ||
    !finite(value.rotation.pitch) ||
    value.rotation.pitch < -90 ||
    value.rotation.pitch > 90 ||
    !finite(value.rotation.yaw) ||
    !finite(value.rotation.headYaw) ||
    !record(value.heldItem) ||
    !exactKeys(value.heldItem, [
      "matchesObservedDirtRegistry",
      "count",
      "metadata",
      "hasStackId",
      "blockRuntimeIdMatchesSupportObservation",
      "transactionExtraIsEmpty",
    ]) ||
    !boolean(value.heldItem.matchesObservedDirtRegistry) ||
    !integer(value.heldItem.count) ||
    value.heldItem.count < 1 ||
    value.heldItem.count > 65_535 ||
    !integer(value.heldItem.metadata) ||
    value.heldItem.metadata < 0 ||
    value.heldItem.metadata > 4_294_967_295 ||
    !boolean(value.heldItem.hasStackId) ||
    !boolean(value.heldItem.blockRuntimeIdMatchesSupportObservation) ||
    !boolean(value.heldItem.transactionExtraIsEmpty) ||
    !record(value.actions) ||
    !exactKeys(value.actions, [
      "count",
      "sourcesAllowlisted",
      "slotMatchesHeldItem",
      "oldItemMatchesHeldItem",
      "newItemCountDelta",
    ]) ||
    !integer(value.actions.count) ||
    value.actions.count < 0 ||
    value.actions.count > 16 ||
    !boolean(value.actions.sourcesAllowlisted) ||
    !boolean(value.actions.slotMatchesHeldItem) ||
    !boolean(value.actions.oldItemMatchesHeldItem) ||
    !integer(value.actions.newItemCountDelta) ||
    value.actions.newItemCountDelta < -1 ||
    value.actions.newItemCountDelta > 0
  ) {
    return undefined;
  }
  if (
    Math.abs(value.support.x) > MAX_HORIZONTAL_WORLD_COORDINATE ||
    Math.abs(value.support.z) > MAX_HORIZONTAL_WORLD_COORDINATE ||
    [value.clickPosition.x, value.clickPosition.y, value.clickPosition.z].some(
      (coordinate) => coordinate < 0 || coordinate > 1,
    ) ||
    [
      value.playerPosition.x - value.support.x,
      value.playerPosition.y - value.support.y,
      value.playerPosition.z - value.support.z,
    ].some(
      (offset) =>
        !Number.isFinite(offset) || Math.abs(offset) > MAX_CAPTURE_OFFSET,
    )
  ) {
    return undefined;
  }
  return value as unknown as GoldenPlacementCaptureCandidate;
};

const freezeFixture = (
  candidate: GoldenPlacementCaptureCandidate,
): AnonymizedGoldenPlacementFixture =>
  Object.freeze({
    schemaVersion: 1 as const,
    protocolVersion: PROTOCOL_VERSION,
    envelope: candidate.envelope,
    authority: Object.freeze({ ...candidate.authority }),
    tickOffset: "0" as const,
    face: candidate.face,
    supportOrigin: Object.freeze({
      x: 0 as const,
      y: 0 as const,
      z: 0 as const,
    }),
    clickPosition: Object.freeze({ ...candidate.clickPosition }),
    playerOffset: Object.freeze({
      x: normalizeOffset(candidate.playerPosition.x - candidate.support.x),
      y: normalizeOffset(candidate.playerPosition.y - candidate.support.y),
      z: normalizeOffset(candidate.playerPosition.z - candidate.support.z),
    }),
    rotation: Object.freeze({ ...candidate.rotation }),
    hotbarSlot: candidate.hotbarSlot,
    heldItem: Object.freeze({ ...candidate.heldItem }),
    actions: Object.freeze({ ...candidate.actions }),
  });

/**
 * Produces a single allow-listed fixture from an already decoded interaction.
 * It never accepts raw packet bytes, identity fields, endpoints, NBT, item
 * names, runtime IDs, stack IDs, or absolute world coordinates.
 */
export class BedrockBlockPlacementGoldenObserver {
  #closed = false;
  #captured = false;

  capture(value: unknown): AnonymizedGoldenPlacementFixture {
    if (this.#closed || this.#captured) {
      throw new Error("Golden block placement observer is unavailable");
    }
    const candidate = parseCandidate(value);
    if (!candidate) {
      throw new Error("Golden block placement observation is invalid");
    }
    this.#captured = true;
    return freezeFixture(candidate);
  }

  close(): void {
    this.#closed = true;
  }
}
