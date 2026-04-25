import { describe, it, expect } from "vitest";
import {
  AppError,
  NotFoundError,
  ValidationError,
  ConflictError,
  RepositoryError,
  AuthorizationError,
} from "@/server/domain/errors";

describe("AppError", () => {
  it("is an instance of Error", () => {
    const err = new AppError("something went wrong", "SOME_CODE");
    expect(err).toBeInstanceOf(Error);
  });

  it("sets name, message, and code", () => {
    const err = new AppError("something went wrong", "SOME_CODE");
    expect(err.name).toBe("AppError");
    expect(err.message).toBe("something went wrong");
    expect(err.code).toBe("SOME_CODE");
  });
});

describe("NotFoundError", () => {
  it("is instanceof AppError and Error", () => {
    const err = new NotFoundError("Note");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name and code", () => {
    const err = new NotFoundError("Note");
    expect(err.name).toBe("NotFoundError");
    expect(err.code).toBe("NOT_FOUND");
  });

  it("produces correct message without id", () => {
    const err = new NotFoundError("Note");
    expect(err.message).toBe("Note not found");
  });

  it("produces correct message with id", () => {
    const err = new NotFoundError("Note", "abc-123");
    expect(err.message).toBe("Note not found: abc-123");
  });
});

describe("ValidationError", () => {
  it("is instanceof AppError and Error", () => {
    const err = new ValidationError("field is required");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name, message, and code", () => {
    const err = new ValidationError("field is required");
    expect(err.name).toBe("ValidationError");
    expect(err.message).toBe("field is required");
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});

describe("ConflictError", () => {
  it("is instanceof AppError and Error", () => {
    const err = new ConflictError("already exists");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name, message, and code", () => {
    const err = new ConflictError("already exists");
    expect(err.name).toBe("ConflictError");
    expect(err.message).toBe("already exists");
    expect(err.code).toBe("CONFLICT");
  });
});

describe("RepositoryError", () => {
  it("is instanceof AppError and Error", () => {
    const err = new RepositoryError("findById");
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name, message, and code", () => {
    const err = new RepositoryError("findById");
    expect(err.name).toBe("RepositoryError");
    expect(err.message).toBe("Repository error during findById");
    expect(err.code).toBe("REPOSITORY_ERROR");
  });

  it("captures cause from an Error instance", () => {
    const cause = new Error("db connection refused");
    const err = new RepositoryError("insert", cause);
    expect(err.cause).toBe(cause);
  });

  it("does not set cause when cause is not an Error", () => {
    const err = new RepositoryError("insert", "some string cause");
    expect(err.cause).toBeUndefined();
  });
});

describe("AuthorizationError", () => {
  it("is instanceof AppError and Error", () => {
    const err = new AuthorizationError();
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
  });

  it("has correct name and code", () => {
    const err = new AuthorizationError();
    expect(err.name).toBe("AuthorizationError");
    expect(err.code).toBe("UNAUTHORIZED");
  });

  it("uses default message when no message provided", () => {
    const err = new AuthorizationError();
    expect(err.message).toBe("Unauthorized");
  });

  it("uses custom message when provided", () => {
    const err = new AuthorizationError("You shall not pass");
    expect(err.message).toBe("You shall not pass");
  });
});
