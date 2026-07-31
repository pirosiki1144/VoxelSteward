export type MovementErrorCode =
  | "INVALID_MOVEMENT_POSITION"
  | "INVALID_MOVEMENT_LIMITS"
  | "MOVEMENT_PLAN_TOO_LARGE"
  | "MOVEMENT_ALREADY_ACTIVE";

export class MovementError extends Error {
  readonly code: MovementErrorCode;

  constructor(code: MovementErrorCode) {
    super(code);
    this.name = "MovementError";
    this.code = code;
  }
}
