export interface CleanupStep {
  readonly name: string;
  readonly run: () => void | Promise<void>;
}

export const runCleanupSteps = async (
  steps: readonly CleanupStep[],
  onFailure: (name: string) => void,
): Promise<void> => {
  for (const step of steps) {
    try {
      await step.run();
    } catch {
      try {
        onFailure(step.name);
      } catch {
        // Cleanup reporting must not prevent remaining cleanup.
      }
    }
  }
};
