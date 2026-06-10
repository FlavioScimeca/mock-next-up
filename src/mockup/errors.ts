export type MockupErrorCode =
  | "MISSING_TEMPLATE_ID"
  | "UNKNOWN_TEMPLATE"
  | "MISSING_DESIGN"
  | "UNSUPPORTED_FILE_TYPE"
  | "MISSING_TEMPLATE_ASSET"
  | "INVALID_CONFIG"
  | "RENDER_FAILURE"
  | "OUTPUT_WRITE_FAILURE";

export class MockupError extends Error {
  readonly code: MockupErrorCode;
  readonly status: number;

  constructor(code: MockupErrorCode, message: string, status: number) {
    super(message);
    this.name = "MockupError";
    this.code = code;
    this.status = status;
  }
}

export function isMockupError(error: unknown): error is MockupError {
  return error instanceof MockupError;
}

export function toErrorResponse(error: unknown): {
  success: false;
  error: string;
  code?: string;
} {
  if (isMockupError(error)) {
    return { success: false, error: error.message, code: error.code };
  }

  if (error instanceof Error) {
    return { success: false, error: error.message, code: "RENDER_FAILURE" };
  }

  return { success: false, error: "Unknown error", code: "RENDER_FAILURE" };
}

export function getErrorStatus(error: unknown): number {
  if (isMockupError(error)) {
    return error.status;
  }
  return 500;
}
