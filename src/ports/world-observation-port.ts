import type {
  ObservedBlock,
  ObservedBlockPosition,
  WorldObservationListener,
  WorldObservationSnapshot,
} from "../domain/world-observation/index.js";

export interface WorldObservationPort {
  getSnapshot(): WorldObservationSnapshot;
  getBlock(position: ObservedBlockPosition): ObservedBlock | undefined;
  subscribe(listener: WorldObservationListener): () => void;
  close(): void;
}
