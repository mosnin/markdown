/**
 * Error types and mapping for canonical API → MCP tool errors.
 */

export interface ApiErrorBody {
  error_code: string;
  message: string;
  request_id?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody
  ) {
    super(body.message);
    this.name = "ApiError";
  }
}

/** Converts an ApiError to a human-readable string for MCP tool error content. */
export function mapApiError(err: ApiError): string {
  switch (err.body.error_code) {
    case "unauthorized":
      return `Authentication failed: ${err.body.message}. Check your CONTEXT_STORE_CONNECTION_SECRET.`;
    case "forbidden":
      return `Access denied: ${err.body.message}. The connection does not have access to this resource.`;
    case "not_found":
      return `Not found: ${err.body.message}`;
    case "bad_request":
      return `Invalid request: ${err.body.message}`;
    default:
      return `API error (${err.body.error_code}): ${err.body.message}`;
  }
}

/** Converts any thrown value to a readable error string. */
export function toErrorString(err: unknown): string {
  if (err instanceof ApiError) return mapApiError(err);
  if (err instanceof Error) return err.message;
  return String(err);
}
