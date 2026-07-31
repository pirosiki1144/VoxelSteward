export type SimpleWorkErrorCode = "INVALID_SIMPLE_WORK_INSTRUCTION";

export class SimpleWorkError extends Error {
  constructor(readonly code: SimpleWorkErrorCode) {
    super(code);
    this.name = "SimpleWorkError";
  }
}
