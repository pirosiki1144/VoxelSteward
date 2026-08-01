import { pathToFileURL } from "node:url";

import { assessBedrockBlockPlacementCapability } from "./adapters/minecraft/bedrock-block-placement-capability.js";
import { loadBlockPlacementAcceptanceConfig } from "./runtime/block-placement-acceptance-config.js";

export interface BlockPlacementAcceptancePreflightDependencies {
  readonly acquireInstanceLock: () => Promise<void>;
  readonly createMinecraftClient: () => void;
  readonly createAuthenticationSession: () => void;
  readonly connectMinecraft: () => Promise<void>;
}

export type BlockPlacementAcceptancePreflightResult =
  | { readonly outcome: "disabled"; readonly exitCode: 0 }
  | {
      readonly outcome: "blocked";
      readonly reason: "protocol_capability_unsupported";
      readonly exitCode: 1;
    };

/**
 * Performs the fail-closed gate before authentication, lock acquisition, client
 * construction, or network access. The dependencies exist only to prove those
 * side effects remain unreachable while capability is unsupported.
 */
export const runBlockPlacementAcceptancePreflight = async (
  environment: NodeJS.ProcessEnv,
  dependencies: BlockPlacementAcceptancePreflightDependencies,
): Promise<BlockPlacementAcceptancePreflightResult> => {
  const config = loadBlockPlacementAcceptanceConfig(environment);
  if (!config.enabled)
    return Object.freeze({ outcome: "disabled", exitCode: 0 });
  const assessment = assessBedrockBlockPlacementCapability(
    config.protocolVersion,
    {
      // Dynamic evidence belongs to a connected generation and cannot exist
      // during this external-side-effect-free preflight.
      dirtItemRegistryMapping: false,
      heldItemTransactionShape: false,
      authoritativeFrame: false,
    },
  );
  if (assessment.capability === "unsupported") {
    return Object.freeze({
      outcome: "blocked",
      reason: "protocol_capability_unsupported",
      exitCode: 1,
    });
  }
  await dependencies.acquireInstanceLock();
  dependencies.createMinecraftClient();
  dependencies.createAuthenticationSession();
  await dependencies.connectMinecraft();
  return Object.freeze({
    outcome: "blocked",
    reason: "protocol_capability_unsupported",
    exitCode: 1,
  });
};

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  const result = await runBlockPlacementAcceptancePreflight(process.env, {
    acquireInstanceLock: () => Promise.resolve(),
    createMinecraftClient: () => undefined,
    createAuthenticationSession: () => undefined,
    connectMinecraft: () => Promise.resolve(),
  });
  process.exitCode = result.exitCode;
}
