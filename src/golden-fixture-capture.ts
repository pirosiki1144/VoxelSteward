import { pathToFileURL } from "node:url";

import { BedrockBlockPlacementCaptureBridge } from "./adapters/minecraft/bedrock-block-placement-capture-bridge.js";
import { DecodedPacketStdinSource } from "./adapters/minecraft/decoded-packet-stdin-source.js";
import { GoldenFixtureTemporaryOutput } from "./adapters/minecraft/golden-fixture-temporary-output.js";
import { InstanceLock } from "./infrastructure/instance-lock.js";
import type {
  DecodedPacketSource,
  GoldenFixtureOutputPort,
} from "./ports/golden-fixture-capture-port.js";
import { loadGoldenFixtureCaptureConfig } from "./runtime/golden-fixture-capture-config.js";

interface CaptureInput extends DecodedPacketSource {
  readonly completed: Promise<void>;
  start(): void;
  close(): void;
}

interface CaptureLock {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export interface GoldenFixtureCaptureDependencies {
  readonly input: CaptureInput;
  readonly output: GoldenFixtureOutputPort;
  readonly lock: CaptureLock;
  readonly signal?: AbortSignal;
}

export type GoldenFixtureCaptureRunResult =
  | {
      readonly outcome: "captured";
      readonly exitCode: 0;
      readonly inspectedPackets: number;
    }
  | {
      readonly outcome: "cancelled" | "incomplete";
      readonly exitCode: 1;
    };

const signalAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

export const runGoldenFixtureCapture = async (
  environment: NodeJS.ProcessEnv,
  dependencies: GoldenFixtureCaptureDependencies,
): Promise<GoldenFixtureCaptureRunResult> => {
  const config = loadGoldenFixtureCaptureConfig(environment);
  if (signalAborted(dependencies.signal)) {
    return Object.freeze({ outcome: "cancelled", exitCode: 1 });
  }
  await dependencies.lock.acquire();
  let bridge: BedrockBlockPlacementCaptureBridge | undefined;
  const abort = (): void => bridge?.close();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signalAborted(dependencies.signal)) {
      return Object.freeze({ outcome: "cancelled", exitCode: 1 });
    }
    bridge = new BedrockBlockPlacementCaptureBridge({
      source: dependencies.input,
      output: dependencies.output,
      version: config.protocolVersion,
      timeoutMs: config.timeoutMs,
      maxPackets: config.maxPackets,
    });
    dependencies.input.start();
    const capture = bridge.result.then((result) => ({
      kind: "captured" as const,
      result,
    }));
    const inputEnded = dependencies.input.completed.then(() => ({
      kind: "input_ended" as const,
    }));
    const settled = await Promise.race([capture, inputEnded]);
    if (settled.kind === "input_ended") {
      bridge.close();
      await bridge.result.catch(() => undefined);
      return Object.freeze({ outcome: "incomplete", exitCode: 1 });
    }
    return Object.freeze({
      outcome: "captured",
      exitCode: 0,
      inspectedPackets: settled.result.inspectedPackets,
    });
  } catch {
    return Object.freeze({
      outcome: signalAborted(dependencies.signal) ? "cancelled" : "incomplete",
      exitCode: 1,
    });
  } finally {
    dependencies.signal?.removeEventListener("abort", abort);
    bridge?.close();
    dependencies.input.close();
    await dependencies.lock.release();
  }
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  const abortController = new AbortController();
  const stop = (): void => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const result = await runGoldenFixtureCapture(process.env, {
      input: new DecodedPacketStdinSource(),
      output: new GoldenFixtureTemporaryOutput(),
      lock: new InstanceLock(
        "/tmp/voxel-steward-golden-capture-locks",
        "decoded-packet-capture",
      ),
      signal: abortController.signal,
    });
    process.stdout.write(
      `${JSON.stringify({ event: "golden_capture.finished", ...result })}\n`,
    );
    process.exitCode = result.exitCode;
  } catch {
    process.stderr.write(
      `${JSON.stringify({ event: "golden_capture.error", exitCode: 1 })}\n`,
    );
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
