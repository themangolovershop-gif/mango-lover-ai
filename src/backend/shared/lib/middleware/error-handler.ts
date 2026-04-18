import type { NextFunction, Request, Response } from "express";

import { env } from "@/backend/config/env";
import { AppError } from "@/backend/shared/lib/errors/app-error";
import { logger } from "@/backend/shared/lib/logger";
import type { ApiErrorResponse } from "@/backend/shared/types/api";

export function errorHandler(
  error: unknown,
  request: Request,
  response: Response,
  _next: NextFunction
) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError({
          message: "An unexpected error occurred.",
          code: "INTERNAL_SERVER_ERROR",
          statusCode: 500,
          details: error instanceof Error ? { message: error.message } : undefined,
          isOperational: false,
        });

  logger.error("http.request.failed", {
    requestId: response.locals.requestId,
    method: request.method,
    path: request.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
    errorMessage: appError.message,
    details: appError.details,
        });

  const baseDetails =
    appError.details && typeof appError.details === "object"
      ? appError.details
      : appError.details !== undefined
        ? { value: appError.details }
        : undefined;

  const responseDetails =
    env.NODE_ENV === "development" && error instanceof Error
      ? {
          ...(baseDetails || {}),
          stack: error.stack,
        }
      : baseDetails;

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      details: responseDetails,
      requestId: response.locals.requestId as string | undefined,
    },
  };

  response.status(appError.statusCode).json(body);
}
