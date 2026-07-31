export type MovementErrorCode =
  | "INVALID_MOVEMENT_POSITION"
  | "INVALID_MOVEMENT_LIMITS"
  | "MOVEMENT_PLAN_TOO_LARGE"
  | "MOVEMENT_ALREADY_ACTIVE"
  | "INVALID_MOVEMENT_FRAME"
  | "UNSUPPORTED_MOVEMENT_PROTOCOL"
  | "MOVEMENT_ADAPTER_CLOSED"
  | "MOVEMENT_OBSERVATION_INVALID"
  | "MOVEMENT_CORRECTED"
  | "MOVEMENT_DISCONNECTED";

export class MovementError extends Error {
  readonly code: MovementErrorCode;

  constructor(code: MovementErrorCode) {
    super(code);
    this.name = "MovementError";
    this.code = code;
  }
}
