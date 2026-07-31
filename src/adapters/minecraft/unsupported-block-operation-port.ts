import type {
  BlockObservation,
  BlockPosition,
  PlaceSingleBlockInstruction,
} from "../../domain/block-operation/index.js";
import {
  BlockOperationPortError,
  type BlockOperationPort,
} from "../../ports/block-operation-port.js";

export class UnsupportedBlockOperationPort implements BlockOperationPort {
  readonly capability = "unsupported" as const;

  observe(
    position: BlockPosition,
    signal: AbortSignal,
  ): Promise<BlockObservation> {
    void position;
    void signal;
    return Promise.reject(new BlockOperationPortError("unsupported"));
  }

  place(
    instruction: PlaceSingleBlockInstruction,
    signal: AbortSignal,
  ): Promise<void> {
    void instruction;
    void signal;
    return Promise.reject(new BlockOperationPortError("unsupported"));
  }

  stop(): void {
    // No transport is created by this fail-closed adapter.
  }
}
