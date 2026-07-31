import type {
  MovementPosition,
  MovementStep,
} from "../domain/movement/index.js";

export interface MovementPort {
  move(step: MovementStep, signal: AbortSignal): Promise<MovementPosition>;
  stop(): void;
}
