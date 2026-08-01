import type { Readable } from "node:stream";

import type { DecodedPacketSource } from "../../ports/golden-fixture-capture-port.js";

const MAX_LINE_BYTES = 256 * 1024;

export class DecodedPacketInputError extends Error {
  readonly code: "INVALID_DECODED_PACKET_INPUT" | "DECODED_PACKET_INPUT_CLOSED";

  constructor(code: DecodedPacketInputError["code"]) {
    super(
      code === "INVALID_DECODED_PACKET_INPUT"
        ? "Decoded packet input is invalid"
        : "Decoded packet input closed before capture",
    );
    this.name = "DecodedPacketInputError";
    this.code = code;
  }
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseLine = (line: string): unknown => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line, (key: string, value: unknown) => {
      if (key === "tick" && typeof value === "string" && /^\d+$/.test(value)) {
        return BigInt(value);
      }
      return value;
    }) as unknown;
  } catch {
    throw new DecodedPacketInputError("INVALID_DECODED_PACKET_INPUT");
  }
  const data = record(record(parsed)?.data);
  if (typeof data?.name !== "string" || !("params" in data)) {
    throw new DecodedPacketInputError("INVALID_DECODED_PACKET_INPUT");
  }
  return parsed;
};

/**
 * Receives newline-delimited decoded packets from a reviewed proxy/test-server
 * relay. Input is neither persisted nor logged and this type has no send API.
 */
export class DecodedPacketStdinSource implements DecodedPacketSource {
  readonly completed: Promise<void>;
  readonly #input: Readable;
  readonly #listeners = new Set<(packet: unknown) => void>();
  readonly #resolve: () => void;
  readonly #reject: (error: DecodedPacketInputError) => void;
  #buffer = "";
  #started = false;
  #closed = false;

  constructor(input: Readable = process.stdin) {
    this.#input = input;
    let resolve!: () => void;
    let reject!: (error: DecodedPacketInputError) => void;
    this.completed = new Promise((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    this.#resolve = resolve;
    this.#reject = reject;
  }

  on(_event: "packet", listener: (packet: unknown) => void): void {
    if (!this.#closed) this.#listeners.add(listener);
  }

  off(_event: "packet", listener: (packet: unknown) => void): void {
    this.#listeners.delete(listener);
  }

  start(): void {
    if (this.#started || this.#closed) return;
    this.#started = true;
    this.#input.setEncoding("utf8");
    this.#input.on("data", this.#onData);
    this.#input.once("end", this.#onEnd);
    this.#input.once("error", this.#onError);
    this.#input.resume();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#detach();
    this.#listeners.clear();
    this.#buffer = "";
    this.#input.pause();
  }

  readonly #onData = (chunk: string | Buffer): void => {
    if (this.#closed) return;
    const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (
      Buffer.byteLength(this.#buffer) + Buffer.byteLength(text) >
      MAX_LINE_BYTES
    ) {
      this.#fail("INVALID_DECODED_PACKET_INPUT");
      return;
    }
    this.#buffer += text;
    while (!this.#closed) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length === 0) continue;
      try {
        const packet = parseLine(line);
        for (const listener of [...this.#listeners]) listener(packet);
      } catch {
        this.#fail("INVALID_DECODED_PACKET_INPUT");
      }
    }
  };

  readonly #onEnd = (): void => {
    if (this.#closed) return;
    if (this.#buffer.length > 0) {
      this.#onData("\n");
      if (this.#closed) return;
    }
    this.#closed = true;
    this.#detach();
    this.#listeners.clear();
    this.#resolve();
  };

  readonly #onError = (): void => {
    this.#fail("INVALID_DECODED_PACKET_INPUT");
  };

  #fail(code: DecodedPacketInputError["code"]): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#detach();
    this.#listeners.clear();
    this.#buffer = "";
    this.#input.pause();
    this.#reject(new DecodedPacketInputError(code));
  }

  #detach(): void {
    this.#input.off("data", this.#onData);
    this.#input.off("end", this.#onEnd);
    this.#input.off("error", this.#onError);
  }
}
