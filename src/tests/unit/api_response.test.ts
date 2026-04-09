import { describe, it, expect } from "vitest";
import {
  apiOk,
  apiError,
  E_UNAUTHORIZED,
  E_FORBIDDEN,
  E_NOT_FOUND,
  E_BAD_REQUEST,
  E_INTERNAL,
} from "@/lib/api/response";

describe("API response envelope", () => {
  describe("apiOk", () => {
    it("wraps data in the standard success envelope", async () => {
      const res = apiOk({ id: "abc" });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data).toEqual({ id: "abc" });
      expect(body.meta.api_version).toBe("v1");
      expect(typeof body.meta.request_id).toBe("string");
      expect(body.meta.request_id).toHaveLength(36); // UUID length
    });

    it("accepts a custom status code", async () => {
      const res = apiOk({ created: true }, 201);
      expect(res.status).toBe(201);
    });

    it("generates a unique request_id per call", async () => {
      const [a, b] = await Promise.all([apiOk({}).json(), apiOk({}).json()]);
      expect(a.meta.request_id).not.toBe(b.meta.request_id);
    });
  });

  describe("apiError", () => {
    it("returns an error envelope with the given code and message", async () => {
      const res = apiError("not_found", "Thing not found", 404);
      const body = await res.json();
      expect(res.status).toBe(404);
      expect(body.error_code).toBe("not_found");
      expect(body.message).toBe("Thing not found");
      expect(typeof body.request_id).toBe("string");
    });
  });

  describe("convenience constructors", () => {
    it("E_UNAUTHORIZED returns 401", async () => {
      const res = E_UNAUTHORIZED();
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error_code).toBe("unauthorized");
    });

    it("E_FORBIDDEN returns 403", async () => {
      const res = E_FORBIDDEN();
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error_code).toBe("forbidden");
    });

    it("E_NOT_FOUND returns 404", async () => {
      const res = E_NOT_FOUND("Missing thing");
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error_code).toBe("not_found");
      expect(body.message).toBe("Missing thing");
    });

    it("E_BAD_REQUEST returns 400", async () => {
      const res = E_BAD_REQUEST("field is required");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error_code).toBe("bad_request");
      expect(body.message).toBe("field is required");
    });

    it("E_INTERNAL returns 500", async () => {
      const res = E_INTERNAL();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error_code).toBe("internal_error");
    });

    it("E_INTERNAL does not leak internal error details", async () => {
      // The default message must not leak stack traces or internal state
      const res = E_INTERNAL();
      const body = await res.json();
      expect(body.message).toBe("Internal server error");
      expect(body.message).not.toContain("Error:");
      expect(body.message).not.toContain("at ");
    });
  });
});
