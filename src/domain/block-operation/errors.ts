export type BlockOperationErrorCode =
  | "INVALID_BLOCK_OPERATION_INSTRUCTION"
  | "BLOCK_OPERATION_ALREADY_ACTIVE"
  | "BLOCK_OPERATION_CLOSED";

export class BlockOperationError extends Error {
  readonly code: BlockOperationErrorCode;

  constructor(code: BlockOperationErrorCode) {
    super(code);
    this.name = "BlockOperationError";
    this.code = code;
  }
}
