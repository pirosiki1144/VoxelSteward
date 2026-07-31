import type {
  BlockObservation,
  BlockPosition,
  PlaceSingleBlockInstruction,
} from "../../src/domain/block-operation/index.js";
import type { BlockOperationPort } from "../../src/ports/block-operation-port.js";

export class FakeBlockOperationPort implements BlockOperationPort {
  readonly capability = "supported" as const;
  readonly observations: BlockPosition[] = [];
  readonly placements: PlaceSingleBlockInstruction[] = [];
  readonly #responses: Array<BlockObservation | Error>;
  placeError: Error | undefined;
  placeHandler:
    | ((
        instruction: PlaceSingleBlockInstruction,
        signal: AbortSignal,
      ) => Promise<void>)
    | undefined;
  stopCalls = 0;

  constructor(responses: Array<BlockObservation | Error>) {
    this.#responses = [...responses];
  }

  observe(
    position: BlockPosition,
    signal: AbortSignal,
  ): Promise<BlockObservation> {
    this.observations.push(Object.freeze({ ...position }));
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    const response = this.#responses.shift();
    if (response instanceof Error) return Promise.reject(response);
    if (response === undefined) return Promise.reject(new Error("no response"));
    return Promise.resolve(response);
  }

  place(
    instruction: PlaceSingleBlockInstruction,
    signal: AbortSignal,
  ): Promise<void> {
    this.placements.push(instruction);
    if (signal.aborted) return Promise.reject(new Error("aborted"));
    if (this.placeHandler !== undefined)
      return this.placeHandler(instruction, signal);
    if (this.placeError !== undefined) return Promise.reject(this.placeError);
    return Promise.resolve();
  }

  stop(): void {
    this.stopCalls += 1;
  }
}
