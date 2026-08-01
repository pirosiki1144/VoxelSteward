import {
  MAX_BLOCK_REACH,
  blockDistance,
  type BlockPosition,
} from "../../domain/block-operation/index.js";
import type { MinecraftDimension } from "../../domain/movement/index.js";
import type { PlayerAuthInputPayload } from "./player-auth-input-frame.js";

export type AuthoritativeFrameOwner = "movement" | "block_placement";

export type AuthoritativeFrameOwnershipErrorCode =
  | "closed"
  | "already_owned"
  | "invalid_tick"
  | "stale_observation"
  | "dimension_mismatch"
  | "out_of_reach"
  | "safety_stop";

export class AuthoritativeFrameOwnershipError extends Error {
  readonly code: AuthoritativeFrameOwnershipErrorCode;

  constructor(code: AuthoritativeFrameOwnershipErrorCode) {
    super(code);
    this.name = "AuthoritativeFrameOwnershipError";
    this.code = code;
  }
}

export interface AuthoritativeFrameLease {
  readonly owner: AuthoritativeFrameOwner;
  readonly tick: bigint;
  commit(): void;
  release(): void;
}

export interface BlockPlacementFrameRequest {
  readonly frame: PlayerAuthInputPayload;
  readonly dimension: MinecraftDimension;
  readonly target: BlockPosition;
  readonly observationRevision: number;
}

/**
 * Serializes ownership of the single PlayerAuthInput stream. It deliberately
 * does not construct an item-interaction payload: the pinned protocol does not
 * prove the placement envelope or numeric face mapping.
 */
export class BedrockAuthoritativeFrameOwnership {
  readonly #getLatestObservationRevision: (() => number) | undefined;
  readonly #getBlockPlacementSafetyAllowed: (() => boolean) | undefined;
  #active:
    | { readonly owner: AuthoritativeFrameOwner; readonly tick: bigint }
    | undefined;
  #lastCommittedTick: bigint | undefined;
  #closed = false;

  constructor(
    options: {
      readonly getLatestObservationRevision?: () => number;
      readonly getBlockPlacementSafetyAllowed?: () => boolean;
    } = {},
  ) {
    this.#getLatestObservationRevision = options.getLatestObservationRevision;
    this.#getBlockPlacementSafetyAllowed =
      options.getBlockPlacementSafetyAllowed;
  }

  acquireMovement(tick: bigint): AuthoritativeFrameLease {
    return this.#acquire("movement", tick);
  }

  acquireBlockPlacement(
    request: BlockPlacementFrameRequest,
  ): AuthoritativeFrameLease {
    const validateGate = (): void => this.#validateBlockPlacementGate(request);
    validateGate();
    if (
      request.target.dimension !== request.dimension ||
      request.frame.position === undefined
    ) {
      throw new AuthoritativeFrameOwnershipError("dimension_mismatch");
    }
    if (
      blockDistance(
        { ...request.frame.position, dimension: request.dimension },
        request.target,
      ) > MAX_BLOCK_REACH
    ) {
      throw new AuthoritativeFrameOwnershipError("out_of_reach");
    }
    return this.#acquire("block_placement", request.frame.tick, validateGate);
  }

  close(): void {
    this.#closed = true;
    this.#active = undefined;
  }

  #acquire(
    owner: AuthoritativeFrameOwner,
    tick: bigint,
    validateBeforeCommit: () => void = () => undefined,
  ): AuthoritativeFrameLease {
    if (this.#closed) throw new AuthoritativeFrameOwnershipError("closed");
    if (this.#active !== undefined) {
      throw new AuthoritativeFrameOwnershipError("already_owned");
    }
    if (
      tick < 0n ||
      (this.#lastCommittedTick !== undefined && tick <= this.#lastCommittedTick)
    ) {
      throw new AuthoritativeFrameOwnershipError("invalid_tick");
    }
    const active = Object.freeze({ owner, tick });
    this.#active = active;
    let settled = false;
    return Object.freeze({
      owner,
      tick,
      commit: () => {
        if (settled || this.#active !== active || this.#closed) {
          throw new AuthoritativeFrameOwnershipError("closed");
        }
        try {
          validateBeforeCommit();
        } catch (error) {
          settled = true;
          if (this.#active === active) this.#active = undefined;
          throw error;
        }
        settled = true;
        this.#lastCommittedTick = tick;
        this.#active = undefined;
      },
      release: () => {
        if (settled) return;
        settled = true;
        if (this.#active === active) this.#active = undefined;
      },
    });
  }

  #validateBlockPlacementGate(request: BlockPlacementFrameRequest): void {
    if (this.#getBlockPlacementSafetyAllowed?.() !== true) {
      throw new AuthoritativeFrameOwnershipError("safety_stop");
    }
    const latestObservationRevision = this.#getLatestObservationRevision?.();
    if (
      !Number.isSafeInteger(request.observationRevision) ||
      request.observationRevision < 0 ||
      latestObservationRevision === undefined ||
      !Number.isSafeInteger(latestObservationRevision) ||
      latestObservationRevision < 0 ||
      request.observationRevision !== latestObservationRevision
    ) {
      throw new AuthoritativeFrameOwnershipError("stale_observation");
    }
  }
}
