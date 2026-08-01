import type {
  ObservedBlock,
  ObservedBlockPosition,
  WorldObservationListener,
  WorldObservationSnapshot,
  SupportedItemIdentifier,
} from "../domain/world-observation/index.js";

export interface WorldObservationPort {
  getSnapshot(): WorldObservationSnapshot;
  getBlock(position: ObservedBlockPosition): ObservedBlock | undefined;
  getItemNetworkId(identifier: SupportedItemIdentifier): number | undefined;
  subscribe(listener: WorldObservationListener): () => void;
  close(): void;
}
