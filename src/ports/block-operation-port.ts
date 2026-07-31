import type {
  BlockObservation,
  BlockPosition,
  PlaceSingleBlockInstruction,
} from "../domain/block-operation/index.js";

export type BlockOperationPortErrorCode =
  "unsupported" | "disconnected" | "operation_failed";

export class BlockOperationPortError extends Error {
  readonly code: BlockOperationPortErrorCode;

  constructor(code: BlockOperationPortErrorCode) {
    super(code);
    this.name = "BlockOperationPortError";
    this.code = code;
  }
}

export interface BlockOperationPort {
  readonly capability: "supported" | "unsupported";
  observe(
    position: BlockPosition,
    signal: AbortSignal,
  ): Promise<BlockObservation>;
  place(
    instruction: PlaceSingleBlockInstruction,
    signal: AbortSignal,
  ): Promise<void>;
  stop(): void;
}
