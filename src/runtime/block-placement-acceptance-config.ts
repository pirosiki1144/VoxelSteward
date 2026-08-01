export type BlockPlacementAcceptanceConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly mode: "normal";
      readonly operatorConfirmed: true;
      readonly maxAttempts: 1;
      readonly protocolVersion: "1.26.30";
    };

const invalid = (): never => {
  throw new Error("Invalid block placement acceptance configuration");
};

export const loadBlockPlacementAcceptanceConfig = (
  environment: NodeJS.ProcessEnv = process.env,
): BlockPlacementAcceptanceConfig => {
  const enabled = environment.BLOCK_PLACEMENT_ACCEPTANCE_ENABLED;
  if (enabled === undefined || enabled === "false") {
    return Object.freeze({ enabled: false });
  }
  if (enabled !== "true") return invalid();
  if (
    environment.BOT_MODE !== "normal" ||
    environment.BLOCK_PLACEMENT_OPERATOR_CONFIRMED !== "true" ||
    environment.BLOCK_PLACEMENT_MAX_ATTEMPTS !== "1" ||
    environment.MINECRAFT_VERSION !== "1.26.30"
  ) {
    return invalid();
  }
  return Object.freeze({
    enabled: true,
    mode: "normal",
    operatorConfirmed: true,
    maxAttempts: 1,
    protocolVersion: "1.26.30",
  });
};
