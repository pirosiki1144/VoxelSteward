import { MovementError } from "./errors.js";
import type {
  MovementLimits,
  MovementPlan,
  MovementPosition,
  MovementStep,
} from "./types.js";

export const MAX_HORIZONTAL_COORDINATE = 30_000_000;
export const MIN_WORLD_Y = -64;
export const MAX_WORLD_Y = 320;

const finiteWithin = (
  value: number,
  minimum: number,
  maximum: number,
): boolean => Number.isFinite(value) && value >= minimum && value <= maximum;

export const validateMovementPosition = (position: MovementPosition): void => {
  if (
    !finiteWithin(
      position.x,
      -MAX_HORIZONTAL_COORDINATE,
      MAX_HORIZONTAL_COORDINATE,
    ) ||
    !finiteWithin(position.y, MIN_WORLD_Y, MAX_WORLD_Y) ||
    !finiteWithin(
      position.z,
      -MAX_HORIZONTAL_COORDINATE,
      MAX_HORIZONTAL_COORDINATE,
    ) ||
    !["overworld", "nether", "end"].includes(position.dimension)
  ) {
    throw new MovementError("INVALID_MOVEMENT_POSITION");
  }
};

export const validateMovementLimits = (limits: MovementLimits): void => {
  if (
    !Number.isFinite(limits.maxStepDistance) ||
    limits.maxStepDistance <= 0 ||
    limits.maxStepDistance > 1 ||
    !Number.isSafeInteger(limits.maxSteps) ||
    limits.maxSteps < 1 ||
    limits.maxSteps > 10_000 ||
    !Number.isSafeInteger(limits.stepTimeoutMs) ||
    limits.stepTimeoutMs < 1 ||
    limits.stepTimeoutMs > 30_000 ||
    !Number.isFinite(limits.arrivalTolerance) ||
    limits.arrivalTolerance < 0 ||
    limits.arrivalTolerance > limits.maxStepDistance
  ) {
    throw new MovementError("INVALID_MOVEMENT_LIMITS");
  }
};

export const distanceBetween = (
  left: MovementPosition,
  right: MovementPosition,
): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);

export const createMovementPlan = (
  origin: MovementPosition,
  target: MovementPosition,
  limits: MovementLimits,
): MovementPlan => {
  validateMovementPosition(origin);
  validateMovementPosition(target);
  validateMovementLimits(limits);
  if (origin.dimension !== target.dimension) {
    throw new MovementError("INVALID_MOVEMENT_POSITION");
  }
  const distance = distanceBetween(origin, target);
  const count = Math.ceil(distance / limits.maxStepDistance);
  if (count > limits.maxSteps) {
    throw new MovementError("MOVEMENT_PLAN_TOO_LARGE");
  }
  const steps: MovementStep[] = [];
  for (let index = 1; index <= count; index += 1) {
    const ratio = index / count;
    steps.push(
      Object.freeze({
        index,
        total: count,
        target: Object.freeze({
          x: origin.x + (target.x - origin.x) * ratio,
          y: origin.y + (target.y - origin.y) * ratio,
          z: origin.z + (target.z - origin.z) * ratio,
          dimension: origin.dimension,
        }),
      }),
    );
  }
  return Object.freeze({
    origin: Object.freeze({ ...origin }),
    target: Object.freeze({ ...target }),
    limits: Object.freeze({ ...limits }),
    steps: Object.freeze(steps),
  });
};

export const isWithinArrivalTolerance = (
  actual: MovementPosition,
  expected: MovementPosition,
  tolerance: number,
): boolean =>
  actual.dimension === expected.dimension &&
  distanceBetween(actual, expected) <= tolerance;
