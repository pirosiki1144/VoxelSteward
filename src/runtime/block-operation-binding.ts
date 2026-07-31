import { UnsupportedBlockOperationPort } from "../adapters/minecraft/unsupported-block-operation-port.js";
import type { BlockOperationPort } from "../ports/block-operation-port.js";

export interface RuntimeBlockOperationBinding {
  readonly enabled: false;
  readonly port: BlockOperationPort;
  close(): void;
}

export const createDisabledRuntimeBlockOperationBinding =
  (): RuntimeBlockOperationBinding => {
    const port = new UnsupportedBlockOperationPort();
    let closed = false;
    return Object.freeze({
      enabled: false as const,
      port,
      close: () => {
        if (closed) return;
        closed = true;
        port.stop();
      },
    });
  };
