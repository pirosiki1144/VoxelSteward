export class InvalidStateTransitionError extends Error {
  override readonly name = "InvalidStateTransitionError";

  constructor(machine: string, from: string, to: string) {
    super(`Invalid ${machine} transition: ${from} -> ${to}`);
  }
}

export class InvalidStateCommandError extends Error {
  override readonly name = "InvalidStateCommandError";
}
