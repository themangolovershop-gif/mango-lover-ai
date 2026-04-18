import cors from 'cors';
import express, { Express, Request, Response } from 'express';

import { env } from './config/env';
import { registerModuleRoutes } from './modules/register-routes';
import { errorHandler } from './shared/lib/middleware/error-handler';
import { notFoundHandler } from './shared/lib/middleware/not-found-handler';
import { requestLogger } from './shared/lib/middleware/request-logger';

const app: Express = express();

app.set('trust proxy', true);

app.use(cors());
app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api', (_req: Request, res: Response) => {
  res.json({ message: 'API Module Router' });
});

registerModuleRoutes(app);

app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'The Mango Lover Shop AI Sales Backend API',
    version: '1.0.0',
    environment: env.NODE_ENV,
  });
});

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
