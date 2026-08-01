import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { AnonymizedGoldenPlacementFixture } from "./bedrock-block-placement-golden-observer.js";
import type { GoldenFixtureOutputPort } from "../../ports/golden-fixture-capture-port.js";

const FORBIDDEN_KEYS = new Set([
  "playerName",
  "gamertag",
  "username",
  "botName",
  "serverAddress",
  "serverPort",
  "endpoint",
  "token",
  "secret",
  "cookie",
  "authorization",
  "networkId",
  "stackId",
  "blockRuntimeId",
  "runtimeEntityId",
  "nbt",
]);
const FORBIDDEN_VALUES = /(?:https?:\/\/|discord(?:app)?\.com\/api\/webhooks)/i;

export const serializeSafeGoldenFixture = (
  fixture: AnonymizedGoldenPlacementFixture,
): string => {
  const serialized = JSON.stringify(fixture, null, 2);
  const parsed = JSON.parse(serialized) as unknown;
  const inspect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) inspect(entry);
      return;
    }
    if (typeof value !== "object" || value === null) {
      if (typeof value === "string" && FORBIDDEN_VALUES.test(value)) {
        throw new Error("Golden fixture failed secret inspection");
      }
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) {
        throw new Error("Golden fixture failed secret inspection");
      }
      inspect(entry);
    }
  };
  inspect(parsed);
  return `${serialized}\n`;
};

/** Writes only the inspected anonymized fixture beneath the OS temporary tree. */
export class GoldenFixtureTemporaryOutput implements GoldenFixtureOutputPort {
  readonly #directory: string;

  constructor(directory = join(tmpdir(), "voxel-steward-golden-fixtures")) {
    const temporaryRoot = resolve(tmpdir());
    const requested = resolve(directory);
    if (
      requested !== temporaryRoot &&
      !requested.startsWith(`${temporaryRoot}/`)
    ) {
      throw new Error("Golden fixture output must use temporary storage");
    }
    this.#directory = requested;
  }

  async write(fixture: AnonymizedGoldenPlacementFixture): Promise<string> {
    const content = serializeSafeGoldenFixture(fixture);
    await mkdir(this.#directory, { recursive: true, mode: 0o700 });
    const captureDirectory = await mkdtemp(join(this.#directory, "capture-"));
    const outputPath = join(captureDirectory, "block-placement-golden.json");
    await writeFile(outputPath, content, { encoding: "utf8", mode: 0o600 });
    return outputPath;
  }
}
