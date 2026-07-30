import { EventEmitter } from "node:events";

import {
  createClient,
  type Client,
  type ClientOptions,
} from "bedrock-protocol";

import type { Logger } from "../../infrastructure/logger.js";
import type {
  BotState,
  ConnectionEvents,
  MinecraftConnectionConfig,
  PlayerEvent,
  Position,
  ReadonlyMinecraftConnection,
} from "../../smoke/types.js";

interface SessionProfile {
  name?: unknown;
}

interface StartGamePacket {
  runtime_entity_id?: unknown;
  dimension?: unknown;
  player_position?: unknown;
}

interface MovePlayerPacket {
  runtime_id?: unknown;
  position?: unknown;
}

interface ChangeDimensionPacket {
  dimension?: unknown;
  position?: unknown;
}

interface Attribute {
  name?: unknown;
  current?: unknown;
}

interface UpdateAttributesPacket {
  runtime_entity_id?: unknown;
  attributes?: unknown;
}

interface PlayerRecord {
  uuid?: unknown;
  username?: unknown;
}

interface PlayerListPacket {
  records?: {
    type?: unknown;
    records?: unknown;
  };
}

const transientErrorCodes = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
]);

const isRetryableConnectionError = (error: Error): boolean => {
  if (!("code" in error) || typeof error.code !== "string") return false;
  return transientErrorCodes.has(error.code);
};

const positionFrom = (value: unknown): Position | undefined => {
  if (value === null || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.x !== "number" ||
    typeof item.y !== "number" ||
    typeof item.z !== "number"
  ) {
    return undefined;
  }
  return { x: item.x, y: item.y, z: item.z };
};

const entityId = (value: unknown): string | undefined => {
  if (typeof value === "bigint" || typeof value === "number") {
    return String(value);
  }
  return undefined;
};

const dimensionFrom = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value === 0) return "overworld";
  if (value === 1) return "nether";
  if (value === 2) return "end";
  return undefined;
};

export class BedrockReadonlyConnection
  extends EventEmitter
  implements ReadonlyMinecraftConnection
{
  readonly #client: Client;
  readonly #logger: Logger;
  readonly #players = new Map<string, string | undefined>();
  #ownRuntimeId?: string;
  #closed = false;

  constructor(config: MinecraftConnectionConfig, logger: Logger) {
    super();
    this.#logger = logger;
    const options: ClientOptions = {
      host: config.host,
      port: config.port,
      username: config.accountId,
      profilesFolder: config.authProfilesFolder,
      offline: false,
      connectTimeout: config.connectionTimeoutMs,
      conLog: null,
      raknetBackend: "raknet-native",
      onMsaCode: (data) => {
        const verificationUri =
          "verification_uri" in data ? String(data.verification_uri) : "";
        const userCode = "user_code" in data ? String(data.user_code) : "";
        this.#logger.log("warn", {
          event: "minecraft.device_authentication_required",
          verificationUri,
          instruction:
            "表示されたURLを開き、Microsoftの画面でコードを入力してください。",
        });
        if (userCode !== "") {
          process.stderr.write(
            `Microsoft device code (認証時のみ使用): ${userCode}\n`,
          );
        }
      },
    };
    if (config.version !== undefined) {
      options.version = config.version as NonNullable<ClientOptions["version"]>;
    }
    this.#client = createClient(options);
    this.#bindClient();
  }

  override on<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this {
    return super.on(event, listener);
  }

  override off<EventName extends keyof ConnectionEvents>(
    event: EventName,
    listener: ConnectionEvents[EventName],
  ): this {
    return super.off(event, listener);
  }

  disconnect(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#logger.log("info", {
      event: "minecraft.disconnecting",
      reason,
    });
    this.#client.disconnect();
  }

  #bindClient(): void {
    this.#client.on("session", (profile: SessionProfile) => {
      if (typeof profile.name === "string") {
        this.emit("authenticated", profile.name);
      }
    });
    this.#client.on("join", () => this.emit("join"));
    this.#client.on("spawn", () => this.emit("spawn"));
    this.#client.on("start_game", (packet: StartGamePacket) => {
      const runtimeId = entityId(packet.runtime_entity_id);
      if (runtimeId !== undefined) this.#ownRuntimeId = runtimeId;
      const dimension = dimensionFrom(packet.dimension);
      const position = positionFrom(packet.player_position);
      this.#emitState({
        ...(dimension === undefined ? {} : { dimension }),
        ...(position === undefined ? {} : { position }),
      });
    });
    this.#client.on("move_player", (packet: MovePlayerPacket) => {
      if (entityId(packet.runtime_id) !== this.#ownRuntimeId) return;
      const position = positionFrom(packet.position);
      if (position !== undefined) this.#emitState({ position });
    });
    this.#client.on("change_dimension", (packet: ChangeDimensionPacket) => {
      const dimension = dimensionFrom(packet.dimension);
      const position = positionFrom(packet.position);
      this.#emitState({
        ...(dimension === undefined ? {} : { dimension }),
        ...(position === undefined ? {} : { position }),
      });
    });
    this.#client.on("update_attributes", (packet: UpdateAttributesPacket) => {
      if (entityId(packet.runtime_entity_id) !== this.#ownRuntimeId) return;
      if (!Array.isArray(packet.attributes)) return;
      const state: Partial<BotState> = {};
      for (const attribute of packet.attributes as Attribute[]) {
        if (typeof attribute.current !== "number") continue;
        if (attribute.name === "minecraft:health") {
          state.health = attribute.current;
        }
        if (attribute.name === "minecraft:player.hunger") {
          state.hunger = attribute.current;
        }
      }
      this.#emitState(state);
    });
    this.#client.on("player_list", (packet: PlayerListPacket) => {
      this.#handlePlayerList(packet);
    });
    this.#client.on("kick", () => {
      this.#logger.log("warn", { event: "minecraft.kicked" });
    });
    this.#client.on("error", (error: unknown) => {
      const normalized =
        error instanceof Error
          ? error
          : new Error("Minecraft connection error");
      this.emit("connectionError", {
        error: normalized,
        retryable: isRetryableConnectionError(normalized),
      });
    });
    this.#client.on("close", () => {
      this.#closed = true;
      this.#logger.log("info", { event: "minecraft.disconnected" });
      this.emit("close");
    });
  }

  #emitState(state: Partial<BotState>): void {
    const available = Object.fromEntries(
      Object.entries(state).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(available).length > 0) this.emit("state", available);
  }

  #handlePlayerList(packet: PlayerListPacket): void {
    const records = packet.records;
    if (
      records === undefined ||
      !Array.isArray(records.records) ||
      (records.type !== "add" && records.type !== "remove")
    ) {
      return;
    }

    for (const rawRecord of records.records as PlayerRecord[]) {
      if (typeof rawRecord.uuid !== "string") continue;
      const detectedAt = new Date().toISOString();
      if (records.type === "add") {
        const name =
          typeof rawRecord.username === "string"
            ? rawRecord.username
            : undefined;
        this.#players.set(rawRecord.uuid, name);
        this.emit("playerJoined", {
          id: rawRecord.uuid,
          ...(name === undefined ? {} : { name }),
          detectedAt,
        } satisfies PlayerEvent);
      } else {
        const name = this.#players.get(rawRecord.uuid);
        this.#players.delete(rawRecord.uuid);
        this.emit("playerLeft", {
          id: rawRecord.uuid,
          ...(name === undefined ? {} : { name }),
          detectedAt,
        } satisfies PlayerEvent);
      }
    }
  }
}
