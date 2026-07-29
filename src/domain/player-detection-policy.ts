import type { BotMode, PlayerEvent } from "../smoke/types.js";

export type PlayerDetectionDecision = "ignore_self" | "continue" | "stop";

export class PlayerDetectionPolicy {
  readonly #mode: BotMode;

  constructor(mode: BotMode) {
    this.#mode = mode;
  }

  decide(
    player: PlayerEvent,
    botPlayerName: string | undefined,
  ): PlayerDetectionDecision {
    if (player.name !== undefined && player.name === botPlayerName) {
      return "ignore_self";
    }
    return this.#mode === "normal" ? "stop" : "continue";
  }
}
