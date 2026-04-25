export class AppError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} not found: ${id}` : `${resource} not found`, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class RepositoryError extends AppError {
  constructor(operation: string, cause?: unknown) {
    super(`Repository error during ${operation}`, "REPOSITORY_ERROR");
    if (cause instanceof Error) this.cause = cause;
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED");
  }
}
