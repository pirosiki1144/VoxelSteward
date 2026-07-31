import type { MovementPort } from "../ports/movement-port.js";

export interface RuntimeMovementBinding {
  readonly enabled: boolean;
  readonly port?: MovementPort;
  close(): void;
}

export type RuntimeMovementBindingFactory = () => RuntimeMovementBinding;

export const createDisabledRuntimeMovementBinding =
  (): RuntimeMovementBinding =>
    Object.freeze({
      enabled: false,
      close: () => undefined,
    });

export const createRuntimeMovementBinding = (
  createPort: () => MovementPort,
): RuntimeMovementBinding => {
  const port = createPort();
  let closed = false;
  return Object.freeze({
    enabled: true,
    port,
    close: () => {
      if (closed) return;
      closed = true;
      port.stop();
    },
  });
};
