export class WorldObservationError extends Error {
  constructor(
    readonly code:
      "INVALID_OBSERVATION" | "OBSERVATION_UNAVAILABLE" | "OBSERVATION_CLOSED",
  ) {
    super(code);
    this.name = "WorldObservationError";
  }
}
