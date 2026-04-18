import type { Request, Response, NextFunction } from "express";

import { logger } from "@/backend/shared/lib/logger";
import { createRequestId } from "@/backend/shared/utils/request-id";

export function requestLogger(request: Request, response: Response, next: NextFunction) {
  const requestId = createRequestId();
  const startedAt = Date.now();

  response.locals.requestId = requestId;
  response.setHeader("x-request-id", requestId);

  logger.info("http.request.started", {
    requestId,
    method: request.method,
    path: request.originalUrl,
  });

  response.on("finish", () => {
    logger.info("http.request.completed", {
      requestId,
      method: request.method,
      path: request.originalUrl,
      statusCode: response.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
}
