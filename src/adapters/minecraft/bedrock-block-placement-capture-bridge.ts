import { BedrockBlockPlacementGoldenObserver } from "./bedrock-block-placement-golden-observer.js";
import type {
  DecodedPacketSource,
  GoldenFixtureCapturePort,
  GoldenFixtureCaptureResult,
  GoldenFixtureOutputPort,
} from "../../ports/golden-fixture-capture-port.js";

const PROTOCOL_VERSION = "1.26.30" as const;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PACKETS = 10_000;
const MAX_BLOCK_OBSERVATIONS = 512;
const ALLOWED_ACTION_SOURCES = new Set([
  "container",
  "global",
  "world_interaction",
  "creative",
]);

type MovementAuthority = "client" | "server" | "server_with_rewind";

interface CaptureClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BedrockBlockPlacementCaptureBridgeOptions {
  readonly source: DecodedPacketSource;
  readonly output: GoldenFixtureOutputPort;
  readonly version: string;
  readonly timeoutMs?: number;
  readonly maxPackets?: number;
  readonly clock?: CaptureClock;
}

export class GoldenFixtureCaptureError extends Error {
  readonly code:
    | "CAPTURE_TIMEOUT"
    | "CAPTURE_PACKET_LIMIT"
    | "CAPTURE_CLOSED"
    | "CAPTURE_OUTPUT_FAILED";

  constructor(code: GoldenFixtureCaptureError["code"]) {
    super(
      code === "CAPTURE_TIMEOUT"
        ? "Golden fixture capture timed out"
        : code === "CAPTURE_PACKET_LIMIT"
          ? "Golden fixture capture packet limit reached"
          : code === "CAPTURE_OUTPUT_FAILED"
            ? "Golden fixture output failed"
            : "Golden fixture capture closed",
    );
    this.name = "GoldenFixtureCaptureError";
    this.code = code;
  }
}

const systemClock: CaptureClock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const integer = (
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum
    ? value
    : undefined;

const bigint = (value: unknown): bigint | undefined =>
  typeof value === "bigint" && value >= 0n ? value : undefined;

const vector = (
  value: unknown,
  integerOnly: boolean,
): { x: number; y: number; z: number } | undefined => {
  const source = record(value);
  const x = integerOnly
    ? integer(source?.x, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    : finite(source?.x);
  const y = integerOnly
    ? integer(source?.y, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    : finite(source?.y);
  const z = integerOnly
    ? integer(source?.z, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
    : finite(source?.z);
  return x === undefined || y === undefined || z === undefined
    ? undefined
    : { x, y, z };
};

const vector2 = (value: unknown): { x: number; z: number } | undefined => {
  const source = record(value);
  const x = finite(source?.x);
  const z = finite(source?.z);
  return x === undefined || z === undefined ? undefined : { x, z };
};

const movementAuthority = (value: unknown): MovementAuthority | undefined =>
  value === "client" || value === "server" || value === "server_with_rewind"
    ? value
    : undefined;

const emptyExtra = (value: unknown): boolean => {
  const extra = record(value);
  return (
    extra !== undefined &&
    (extra.has_nbt === false || extra.has_nbt === "false") &&
    Array.isArray(extra.can_place_on) &&
    extra.can_place_on.length === 0 &&
    Array.isArray(extra.can_destroy) &&
    extra.can_destroy.length === 0
  );
};

interface ItemProjection {
  readonly networkId: number;
  readonly count: number;
  readonly metadata: number;
  readonly blockRuntimeId: number;
  readonly hasStackId: boolean;
  readonly transactionExtraIsEmpty: boolean;
}

interface AuthoritativeFrameProjection {
  readonly tick: bigint;
  readonly playerPosition: { x: number; y: number; z: number };
  readonly rotation: { pitch: number; yaw: number; headYaw: number };
}

const itemProjection = (value: unknown): ItemProjection | undefined => {
  const item = record(value);
  const networkId = integer(item?.network_id, -32_768, 32_767);
  const count = integer(item?.count, 0, 65_535);
  const metadata = integer(item?.metadata, 0, 4_294_967_295);
  const blockRuntimeId = integer(item?.block_runtime_id, 0, 4_294_967_295);
  if (
    networkId === undefined ||
    count === undefined ||
    metadata === undefined ||
    blockRuntimeId === undefined
  ) {
    return undefined;
  }
  const stack = record(item?.stack_id);
  const hasStackId =
    (item?.has_stack_id === true || item?.has_stack_id === 1) &&
    integer(stack?.id ?? item?.stack_id, 1, 2_147_483_647) !== undefined;
  return {
    networkId,
    count,
    metadata,
    blockRuntimeId,
    hasStackId,
    transactionExtraIsEmpty: emptyExtra(item?.extra),
  };
};

interface ActionItemProjection {
  readonly networkId: number;
  readonly count: number;
  readonly metadata: number;
  readonly blockRuntimeId: number;
}

const actionItemProjection = (
  value: unknown,
): ActionItemProjection | undefined => {
  const item = record(value);
  const networkId = integer(item?.network_id, -32_768, 32_767);
  const count = integer(item?.count, 0, 65_535);
  const metadata = integer(item?.metadata, 0, 4_294_967_295);
  const blockRuntimeId = integer(item?.block_runtime_id, 0, 4_294_967_295);
  return networkId === undefined ||
    count === undefined ||
    metadata === undefined ||
    blockRuntimeId === undefined
    ? undefined
    : { networkId, count, metadata, blockRuntimeId };
};

const sameItem = (
  action: ActionItemProjection | undefined,
  held: ItemProjection,
): boolean =>
  action !== undefined &&
  action.networkId === held.networkId &&
  action.metadata === held.metadata &&
  action.blockRuntimeId === held.blockRuntimeId &&
  action.count === held.count;

const positionKey = (position: {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}): string => `${position.x},${position.y},${position.z}`;

const sameVector = (
  left: { readonly x: number; readonly y: number; readonly z: number },
  right: { readonly x: number; readonly y: number; readonly z: number },
): boolean =>
  Math.abs(left.x - right.x) <= 0.000_001 &&
  Math.abs(left.y - right.y) <= 0.000_001 &&
  Math.abs(left.z - right.z) <= 0.000_001;

/**
 * Observes decoded packet objects only. Each handler immediately projects an
 * allow-listed subset; packet objects are never retained, logged, or emitted.
 */
export class BedrockBlockPlacementCaptureBridge implements GoldenFixtureCapturePort {
  readonly result: Promise<GoldenFixtureCaptureResult>;
  readonly #source: DecodedPacketSource;
  readonly #output: GoldenFixtureOutputPort;
  readonly #observer = new BedrockBlockPlacementGoldenObserver();
  readonly #clock: CaptureClock;
  readonly #maxPackets: number;
  readonly #blocks = new Map<string, number>();
  readonly #listener: (packet: unknown) => void;
  readonly #resolve: (result: GoldenFixtureCaptureResult) => void;
  readonly #reject: (error: GoldenFixtureCaptureError) => void;
  readonly #timeoutHandle: unknown;
  #serverAuthoritativeInventory: boolean | undefined;
  #movementAuthority: MovementAuthority | undefined;
  #authority:
    | {
        readonly serverAuthoritativeInventory: boolean;
        readonly movementAuthority: MovementAuthority;
      }
    | undefined;
  #dirtNetworkId: number | undefined;
  #latestFrame: AuthoritativeFrameProjection | undefined;
  #inspectedPackets = 0;
  #closed = false;
  #settled = false;

  constructor(options: BedrockBlockPlacementCaptureBridgeOptions) {
    if (options.version !== PROTOCOL_VERSION) {
      throw new Error("Unsupported Golden fixture protocol version");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxPackets = options.maxPackets ?? DEFAULT_MAX_PACKETS;
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 300_000 ||
      !Number.isSafeInteger(maxPackets) ||
      maxPackets < 1 ||
      maxPackets > 100_000
    ) {
      throw new Error("Invalid Golden fixture capture limits");
    }
    this.#source = options.source;
    this.#output = options.output;
    this.#clock = options.clock ?? systemClock;
    this.#maxPackets = maxPackets;
    let resolve!: (result: GoldenFixtureCaptureResult) => void;
    let reject!: (error: GoldenFixtureCaptureError) => void;
    this.result = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.#resolve = resolve;
    this.#reject = reject;
    this.#listener = (packet) => this.#receive(packet);
    this.#timeoutHandle = this.#clock.setTimeout(
      () => this.#finishWithError("CAPTURE_TIMEOUT"),
      timeoutMs,
    );
    try {
      this.#source.on("packet", this.#listener);
    } catch (error) {
      this.#clock.clearTimeout(this.#timeoutHandle);
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#detach();
    if (!this.#settled) {
      this.#settled = true;
      this.#reject(new GoldenFixtureCaptureError("CAPTURE_CLOSED"));
    }
  }

  #detach(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#observer.close();
    this.#clock.clearTimeout(this.#timeoutHandle);
    try {
      this.#source.off("packet", this.#listener);
    } catch {
      // The capture remains closed even if the external source rejects cleanup.
    }
    this.#blocks.clear();
    this.#latestFrame = undefined;
    this.#dirtNetworkId = undefined;
    this.#authority = undefined;
    this.#serverAuthoritativeInventory = undefined;
    this.#movementAuthority = undefined;
  }

  #finishWithError(code: GoldenFixtureCaptureError["code"]): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#detach();
    this.#reject(new GoldenFixtureCaptureError(code));
  }

  #receive(decoded: unknown): void {
    if (this.#closed || this.#settled) return;
    this.#inspectedPackets += 1;
    if (this.#inspectedPackets > this.#maxPackets) {
      this.#finishWithError("CAPTURE_PACKET_LIMIT");
      return;
    }
    const data = record(record(decoded)?.data);
    const name = data?.name;
    const params = data?.params;
    if (typeof name !== "string") return;
    try {
      switch (name) {
        case "start_game":
          this.#observeStartGame(params);
          break;
        case "set_movement_authority":
          this.#observeMovementAuthority(params);
          break;
        case "item_registry":
          this.#observeItemRegistry(params);
          break;
        case "update_block":
          this.#observeBlock(params);
          break;
        case "player_auth_input":
          this.#observePlayerAuthInput(params);
          break;
        case "inventory_transaction":
          this.#observeStandaloneTransaction(params);
          break;
      }
    } catch {
      // Malformed decoded input is ignored without exposing the packet or error.
    }
  }

  #observeStartGame(value: unknown): void {
    const packet = record(value);
    if (typeof packet?.server_authoritative_inventory !== "boolean") return;
    this.#serverAuthoritativeInventory = packet.server_authoritative_inventory;
    this.#movementAuthority = movementAuthority(packet.movement_authority);
    this.#refreshAuthority();
  }

  #observeMovementAuthority(value: unknown): void {
    const packet = record(value);
    const authority = movementAuthority(packet?.movement_authority);
    if (authority === undefined) return;
    this.#movementAuthority = authority;
    this.#refreshAuthority();
  }

  #refreshAuthority(): void {
    this.#authority =
      this.#serverAuthoritativeInventory === undefined ||
      this.#movementAuthority === undefined
        ? undefined
        : {
            serverAuthoritativeInventory: this.#serverAuthoritativeInventory,
            movementAuthority: this.#movementAuthority,
          };
  }

  #observeItemRegistry(value: unknown): void {
    const entries = record(value)?.itemstates;
    if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8192)
      return;
    let dirtNetworkId: number | undefined;
    const ids = new Set<number>();
    const names = new Set<string>();
    for (const entry of entries) {
      const item = record(entry);
      const name = item?.name;
      const id = integer(item?.runtime_id, -32_768, 32_767);
      if (
        typeof name !== "string" ||
        !/^[a-z0-9_.-]+:[a-z0-9_./-]+$/.test(name) ||
        id === undefined ||
        id === 0 ||
        names.has(name) ||
        ids.has(id)
      ) {
        this.#dirtNetworkId = undefined;
        return;
      }
      names.add(name);
      ids.add(id);
      if (name === "minecraft:dirt") dirtNetworkId = id;
    }
    this.#dirtNetworkId = dirtNetworkId;
  }

  #observeBlock(value: unknown): void {
    const packet = record(value);
    const position = vector(packet?.position, true);
    const runtimeId = integer(packet?.block_runtime_id, 0, 4_294_967_295);
    const layer = integer(packet?.layer, 0, 255);
    if (position === undefined || runtimeId === undefined || layer !== 0)
      return;
    if (this.#blocks.size >= MAX_BLOCK_OBSERVATIONS) {
      this.#blocks.delete(this.#blocks.keys().next().value as string);
    }
    this.#blocks.set(positionKey(position), runtimeId);
  }

  #observePlayerAuthInput(value: unknown): void {
    const packet = record(value);
    const frame = this.#frameFrom(packet);
    if (frame === undefined) return;
    this.#latestFrame = frame;
    const flags = record(packet?.input_data);
    if (flags?.item_interact !== true) return;
    const transaction = record(packet?.transaction);
    this.#captureTransaction(
      "player_auth_input_item_interact",
      transaction?.actions,
      transaction?.data,
      frame,
    );
  }

  #observeStandaloneTransaction(value: unknown): void {
    const transaction = record(record(value)?.transaction);
    if (
      transaction?.transaction_type !== "item_use" ||
      this.#latestFrame === undefined
    ) {
      return;
    }
    this.#captureTransaction(
      "inventory_transaction",
      transaction.actions,
      transaction.transaction_data,
      this.#latestFrame,
    );
  }

  #frameFrom(value: Record<string, unknown> | undefined) {
    const tick = bigint(value?.tick);
    const playerPosition = vector(value?.position, false);
    const pitch = finite(value?.pitch);
    const yaw = finite(value?.yaw);
    const headYaw = finite(value?.head_yaw);
    if (
      tick === undefined ||
      playerPosition === undefined ||
      pitch === undefined ||
      yaw === undefined ||
      headYaw === undefined ||
      vector2(value?.move_vector) === undefined
    ) {
      return undefined;
    }
    return {
      tick,
      playerPosition,
      rotation: { pitch, yaw, headYaw },
    };
  }

  #captureTransaction(
    envelope: "inventory_transaction" | "player_auth_input_item_interact",
    rawActions: unknown,
    rawData: unknown,
    frame: AuthoritativeFrameProjection,
  ): void {
    if (
      this.#authority === undefined ||
      this.#dirtNetworkId === undefined ||
      !Array.isArray(rawActions) ||
      rawActions.length > 16
    ) {
      return;
    }
    const data = record(rawData);
    if (
      data?.action_type !== "click_block" ||
      data.trigger_type !== "player_input"
    ) {
      return;
    }
    const support = vector(data.block_position, true);
    const clickPosition = vector(data.click_pos, false);
    const transactionPlayerPosition = vector(data.player_pos, false);
    const face = integer(data.face, 0, 255);
    const hotbarSlot = integer(data.hotbar_slot, 0, 8);
    const heldItem = itemProjection(data.held_item);
    const observedSupportRuntimeId =
      support === undefined
        ? undefined
        : this.#blocks.get(positionKey(support));
    const transactionRuntimeId = integer(
      data.block_runtime_id,
      0,
      4_294_967_295,
    );
    if (
      support === undefined ||
      clickPosition === undefined ||
      transactionPlayerPosition === undefined ||
      !sameVector(transactionPlayerPosition, frame.playerPosition) ||
      face === undefined ||
      hotbarSlot === undefined ||
      heldItem === undefined ||
      observedSupportRuntimeId === undefined ||
      transactionRuntimeId === undefined
    ) {
      return;
    }
    const actions = rawActions.map(record);
    if (actions.some((action) => action === undefined)) return;
    const selected = actions.find(
      (action) => integer(action?.slot, 0, 255) === hotbarSlot,
    );
    const oldItem = actionItemProjection(selected?.old_item);
    const newItem = actionItemProjection(selected?.new_item);
    const candidate = {
      protocolVersion: PROTOCOL_VERSION,
      envelope,
      authority: this.#authority,
      tick: frame.tick,
      face,
      support,
      clickPosition,
      playerPosition: frame.playerPosition,
      rotation: frame.rotation,
      hotbarSlot,
      heldItem: {
        matchesObservedDirtRegistry: heldItem.networkId === this.#dirtNetworkId,
        count: heldItem.count,
        metadata: heldItem.metadata,
        hasStackId: heldItem.hasStackId,
        blockRuntimeIdMatchesSupportObservation:
          transactionRuntimeId === observedSupportRuntimeId,
        transactionExtraIsEmpty: heldItem.transactionExtraIsEmpty,
      },
      actions: {
        count: actions.length,
        sourcesAllowlisted: actions.every((action) =>
          ALLOWED_ACTION_SOURCES.has(String(action?.source_type)),
        ),
        slotMatchesHeldItem: selected !== undefined,
        oldItemMatchesHeldItem: sameItem(oldItem, heldItem),
        newItemCountDelta:
          oldItem === undefined || newItem === undefined
            ? 0
            : newItem.count - oldItem.count,
      },
    };
    let fixture;
    try {
      fixture = this.#observer.capture(candidate);
    } catch {
      return;
    }
    const inspectedPackets = this.#inspectedPackets;
    this.#settled = true;
    this.#detach();
    void this.#output.write(fixture).then(
      (outputLocation) =>
        this.#resolve(
          Object.freeze({ fixture, outputLocation, inspectedPackets }),
        ),
      () => {
        this.#reject(new GoldenFixtureCaptureError("CAPTURE_OUTPUT_FAILED"));
      },
    );
  }
}
