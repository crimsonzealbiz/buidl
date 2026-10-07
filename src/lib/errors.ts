export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "precondition_failed"
  | "not_configured"
  | "upstream_failed";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 400,
  conflict: 409,
  precondition_failed: 422,
  not_configured: 503,
  upstream_failed: 502,
};

/** An expected failure with a message that is safe to show the user. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
  get status() {
    return STATUS[this.code];
  }
}

export function assert(condition: unknown, code: ErrorCode, message: string): asserts condition {
  if (!condition) throw new AppError(code, message);
}
