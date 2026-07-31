import { MovementError } from "../../domain/movement/index.js";

export const SUPPORTED_MOVEMENT_PROTOCOL_VERSIONS = ["1.26.30"] as const;

export type SupportedMovementProtocolVersion =
  (typeof SUPPORTED_MOVEMENT_PROTOCOL_VERSIONS)[number];

export interface Vec2 {
  readonly x: number;
  readonly z: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface PlayerAuthInputFrameDraft {
  readonly tick: bigint;
  readonly position: Vec3;
  readonly delta: Vec3;
  readonly moveVector: Vec2;
  readonly pitch: number;
  readonly yaw: number;
  readonly headYaw: number;
  readonly cameraOrientation: Vec3;
}

export interface PlayerAuthInputPayload {
  readonly pitch: number;
  readonly yaw: number;
  readonly position: Vec3;
  readonly move_vector: Vec2;
  readonly head_yaw: number;
  readonly input_data: Readonly<Record<string, never>>;
  readonly input_mode: "mouse";
  readonly play_mode: "normal";
  readonly interaction_model: "crosshair";
  readonly interact_rotation: Vec2;
  readonly tick: bigint;
  readonly delta: Vec3;
  readonly analogue_move_vector: Vec2;
  readonly camera_orientation: Vec3;
  readonly raw_move_vector: Vec2;
}

const finite = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new MovementError("INVALID_MOVEMENT_FRAME");
  }
  return value;
};

const vec2 = (value: Vec2): Vec2 =>
  Object.freeze({ x: finite(value.x), z: finite(value.z) });

const vec3 = (value: Vec3): Vec3 =>
  Object.freeze({
    x: finite(value.x),
    y: finite(value.y),
    z: finite(value.z),
  });

export const assertSupportedMovementProtocolVersion = (
  version: string,
): SupportedMovementProtocolVersion => {
  if (!SUPPORTED_MOVEMENT_PROTOCOL_VERSIONS.includes(version as "1.26.30")) {
    throw new MovementError("UNSUPPORTED_MOVEMENT_PROTOCOL");
  }
  return version as SupportedMovementProtocolVersion;
};

export const createPlayerAuthInputFrame = (
  version: string,
  draft: PlayerAuthInputFrameDraft,
): PlayerAuthInputPayload => {
  assertSupportedMovementProtocolVersion(version);
  if (draft.tick < 0n) throw new MovementError("INVALID_MOVEMENT_FRAME");
  const moveVector = vec2(draft.moveVector);
  return Object.freeze({
    pitch: finite(draft.pitch),
    yaw: finite(draft.yaw),
    position: vec3(draft.position),
    move_vector: moveVector,
    head_yaw: finite(draft.headYaw),
    input_data: Object.freeze({}),
    input_mode: "mouse",
    play_mode: "normal",
    interaction_model: "crosshair",
    interact_rotation: Object.freeze({
      x: finite(draft.pitch),
      z: finite(draft.yaw),
    }),
    tick: draft.tick,
    delta: vec3(draft.delta),
    analogue_move_vector: moveVector,
    camera_orientation: vec3(draft.cameraOrientation),
    raw_move_vector: moveVector,
  });
};

export const createNeutralPlayerAuthInputFrame = (
  version: string,
  draft: Omit<PlayerAuthInputFrameDraft, "delta" | "moveVector">,
): PlayerAuthInputPayload =>
  createPlayerAuthInputFrame(version, {
    ...draft,
    delta: { x: 0, y: 0, z: 0 },
    moveVector: { x: 0, z: 0 },
  });
