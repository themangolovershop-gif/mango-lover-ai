export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly isOperational: boolean;

  constructor(args: {
    message: string;
    code: string;
    statusCode: number;
    details?: unknown;
    isOperational?: boolean;
  }) {
    super(args.message);
    this.name = this.constructor.name;
    this.code = args.code;
    this.statusCode = args.statusCode;
    this.details = args.details;
    this.isOperational = args.isOperational ?? true;
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Requested resource was not found.", details?: unknown) {
    super({
      message,
      code: "NOT_FOUND",
      statusCode: 404,
      details,
    });
  }
}

export class NotImplementedError extends AppError {
  constructor(message = "This endpoint is scaffolded but not implemented yet.", details?: unknown) {
    super({
      message,
      code: "NOT_IMPLEMENTED",
      statusCode: 501,
      details,
    });
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed.", details?: unknown) {
    super({
      message,
      code: "VALIDATION_ERROR",
      statusCode: 400,
      details,
    });
  }
}
