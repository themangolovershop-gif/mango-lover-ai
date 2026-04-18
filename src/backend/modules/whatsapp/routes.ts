import { Router } from 'express';

import { handleInboundWhatsAppWebhook } from '@/backend/modules/whatsapp/controller';
import type { HealthResponse } from '@/backend/shared/types/api';

export const whatsappRouter = Router();

whatsappRouter.get('/health', (_request, response) => {
  const body: HealthResponse = {
    success: true,
    data: {
      service: 'whatsapp',
      status: 'ok',
      environment: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString(),
    },
  };

  response.status(200).json(body);
});

whatsappRouter.post('/', handleInboundWhatsAppWebhook);
