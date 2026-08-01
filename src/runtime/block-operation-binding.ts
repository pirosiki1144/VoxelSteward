import { UnsupportedBlockOperationPort } from "../adapters/minecraft/unsupported-block-operation-port.js";
import {
  BlockOperationCoordinator,
  type BlockOperationCoordinatorOptions,
} from "../application/block-operation/index.js";
import type { BlockOperationPort } from "../ports/block-operation-port.js";

export type RuntimeBlockOperationBinding =
  | {
      readonly enabled: false;
      readonly port: BlockOperationPort;
      close(): void;
    }
  | {
      readonly enabled: true;
      readonly port: BlockOperationPort;
      readonly coordinator: BlockOperationCoordinator;
      close(): void;
    };

export interface AcceptanceBlockOperationOptions extends BlockOperationCoordinatorOptions {
  readonly approvedForDedicatedTestServer: true;
}

export const createAcceptanceRuntimeBlockOperationBinding = (
  options: AcceptanceBlockOperationOptions,
): RuntimeBlockOperationBinding => {
  if (options.port.capability !== "supported") {
    throw new Error("Block operation adapter is unsupported");
  }
  const coordinator = new BlockOperationCoordinator(options);
  let closed = false;
  return Object.freeze({
    enabled: true as const,
    port: options.port,
    coordinator,
    close: () => {
      if (closed) return;
      closed = true;
      coordinator.close();
    },
  });
};

interface DisabledRuntimeBlockOperationBinding {
  readonly enabled: false;
  readonly port: BlockOperationPort;
  close(): void;
}

export const createDisabledRuntimeBlockOperationBinding =
  (): DisabledRuntimeBlockOperationBinding => {
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
