import { WorldObservationStore } from "../domain/world-observation/index.js";
import type { WorldObservationPort } from "../ports/world-observation-port.js";

export interface RuntimeWorldObservationBinding {
  readonly enabled: boolean;
  readonly port: WorldObservationPort;
  close(): void;
}

export const createDisabledRuntimeWorldObservationBinding =
  (): RuntimeWorldObservationBinding => {
    const port = new WorldObservationStore();
    let closed = false;
    return Object.freeze({
      enabled: false,
      port,
      close: () => {
        if (closed) return;
        closed = true;
        port.close();
      },
    });
  };

export const createRuntimeWorldObservationBinding = (
  createPort: () => WorldObservationPort,
): RuntimeWorldObservationBinding => {
  const port = createPort();
  let closed = false;
  return Object.freeze({
    enabled: true,
    port,
    close: () => {
      if (closed) return;
      closed = true;
      port.close();
    },
  });
};
