import { Request, Response, NextFunction } from 'express';
import { AppError } from './AppError';
import { env } from '../../config/env';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  // Log error for developers
  if (env.NODE_ENV !== 'test') {
    console.error(`[ERROR] ${req.method} ${req.path} - ${message}`);
    if (!(err instanceof AppError) || env.LOG_LEVEL === 'debug') {
      console.error(err.stack);
    }
  }

  res.status(statusCode).json({
    status: 'error',
    message,
    ...(env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
