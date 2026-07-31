import type {
  MovementPosition,
  MovementStep,
} from "../../src/domain/movement/index.js";
import type { MovementPort } from "../../src/ports/movement-port.js";

export type FakeMoveHandler = (
  step: MovementStep,
  signal: AbortSignal,
) => Promise<MovementPosition> | MovementPosition;

export class FakeMovementPort implements MovementPort {
  readonly steps: MovementStep[] = [];
  stopCalls = 0;
  #handler: FakeMoveHandler;

  constructor(
    handler: FakeMoveHandler = (step) => Promise.resolve(step.target),
  ) {
    this.#handler = handler;
  }

  move(step: MovementStep, signal: AbortSignal): Promise<MovementPosition> {
    this.steps.push(step);
    return Promise.resolve(this.#handler(step, signal));
  }

  stop(): void {
    this.stopCalls += 1;
  }
}
