import type { Request, Response, NextFunction } from "express";

import { NotFoundError } from "@/backend/shared/lib/errors/app-error";

export function notFoundHandler(request: Request, _response: Response, next: NextFunction) {
  next(
    new NotFoundError(`No route registered for ${request.method} ${request.originalUrl}.`)
  );
}
