import { app } from './app';
import { env } from './config/env';
import { logger } from './shared/lib/logger';
import { getPrismaClient } from './shared/lib/prisma';

const PORT = env.PORT || 3001;

const server = app.listen(PORT, () => {
  logger.info('server.started', {
    environment: env.NODE_ENV,
    port: PORT,
    healthUrl: `http://localhost:${PORT}/health`,
  });
});

async function shutdown(signal: 'SIGTERM' | 'SIGINT') {
  logger.info('server.shutdown.requested', { signal });

  server.close(async () => {
    await getPrismaClient().$disconnect().catch((error) => {
      logger.error('server.shutdown.prisma_disconnect_failed', {
        signal,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    logger.info('server.shutdown.completed', { signal });
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
