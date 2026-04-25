import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mock @/lib/logger before importing the module under test so vi.hoisted
// captures the spy instances we assert on.
// ---------------------------------------------------------------------------

const { mockLoggerError } = vi.hoisted(() => {
  return { mockLoggerError: vi.fn() };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { withApiHandler } from "@/server/api/with_api_handler";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  AuthorizationError,
  RepositoryError,
} from "@/server/domain/errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(): NextRequest {
  return new NextRequest("http://localhost/api/test", { method: "GET" });
}

type RouteContext = { params: Promise<Record<string, string>> };

function makeCtx(): RouteContext {
  return { params: Promise.resolve({}) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withApiHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through a successful response from the handler", async () => {
    const handler = withApiHandler(async () => {
      return Response.json({ ok: true }, { status: 200 });
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps NotFoundError to 404 with error and code", async () => {
    const handler = withApiHandler(async () => {
      throw new NotFoundError("Note", "abc-123");
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Note not found: abc-123");
    expect(body.code).toBe("NOT_FOUND");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps ValidationError to 400 with error and code", async () => {
    const handler = withApiHandler(async () => {
      throw new ValidationError("title is required");
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("title is required");
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps ConflictError to 409 with error and code", async () => {
    const handler = withApiHandler(async () => {
      throw new ConflictError("note already exists");
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("note already exists");
    expect(body.code).toBe("CONFLICT");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps AuthorizationError to 401 with error and code", async () => {
    const handler = withApiHandler(async () => {
      throw new AuthorizationError();
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(body.code).toBe("UNAUTHORIZED");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps RepositoryError to 500 with error and code", async () => {
    const handler = withApiHandler(async () => {
      throw new RepositoryError("findById", new Error("db down"));
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Repository error during findById");
    expect(body.code).toBe("REPOSITORY_ERROR");
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("maps unknown Error to 500 with generic message and calls logger.error", async () => {
    const unknownError = new Error("something totally unexpected");
    const handler = withApiHandler(async () => {
      throw unknownError;
    });

    const res = await handler(makeRequest(), makeCtx());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("Internal server error");
    expect(body.code).toBeUndefined();

    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(mockLoggerError).toHaveBeenCalledWith(
      { err: unknownError },
      "Unhandled API route error"
    );
  });
});
