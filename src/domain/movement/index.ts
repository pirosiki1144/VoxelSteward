export { MovementError, type MovementErrorCode } from "./errors.js";
export {
  createMovementPlan,
  distanceBetween,
  isWithinArrivalTolerance,
  MAX_HORIZONTAL_COORDINATE,
  MAX_WORLD_Y,
  MIN_WORLD_Y,
  validateMovementLimits,
  validateMovementPosition,
} from "./movement-plan.js";
export type {
  MinecraftDimension,
  MovementCommand,
  MovementLimits,
  MovementPlan,
  MovementPosition,
  MovementResult,
  MovementStep,
} from "./types.js";
