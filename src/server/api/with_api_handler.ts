import { type NextRequest } from "next/server";
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  AuthorizationError,
  RepositoryError,
} from "@/server/domain/errors";
import { logger } from "@/lib/logger";

type RouteContext = { params: Promise<Record<string, string>> };
type RouteHandler = (req: NextRequest, ctx: RouteContext) => Promise<Response>;

/**
 * Wraps a Next.js route handler with uniform error handling.
 *
 * Typed AppError subclasses are mapped to appropriate HTTP status codes.
 * Unhandled errors are logged with pino and returned as 500.
 *
 * Usage:
 *   export const GET = withApiHandler(async (req, ctx) => { ... });
 */
export function withApiHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 404 }
        );
      }
      if (err instanceof ValidationError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 400 }
        );
      }
      if (err instanceof ConflictError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 409 }
        );
      }
      if (err instanceof AuthorizationError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 401 }
        );
      }
      if (err instanceof RepositoryError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 500 }
        );
      }
      if (err instanceof AppError) {
        return Response.json(
          { error: err.message, code: err.code },
          { status: 500 }
        );
      }
      logger.error({ err }, "Unhandled API route error");
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
