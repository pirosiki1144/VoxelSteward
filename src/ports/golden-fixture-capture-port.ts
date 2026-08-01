import type { AnonymizedGoldenPlacementFixture } from "../adapters/minecraft/bedrock-block-placement-golden-observer.js";

export interface DecodedBedrockPacket {
  readonly data: {
    readonly name: unknown;
    readonly params: unknown;
  };
}

export interface DecodedPacketSource {
  on(event: "packet", listener: (packet: unknown) => void): void;
  off(event: "packet", listener: (packet: unknown) => void): void;
}

export interface GoldenFixtureOutputPort {
  write(fixture: AnonymizedGoldenPlacementFixture): Promise<string>;
}

export interface GoldenFixtureCaptureResult {
  readonly fixture: AnonymizedGoldenPlacementFixture;
  readonly outputLocation: string;
  readonly inspectedPackets: number;
}

export interface GoldenFixtureCapturePort {
  readonly result: Promise<GoldenFixtureCaptureResult>;
  close(): void;
}
