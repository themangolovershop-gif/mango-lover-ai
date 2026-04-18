import type { Express } from "express";

import { analyticsRouter } from "@/backend/modules/analytics/routes";
import { aiRouter } from "@/backend/modules/ai/routes";
import { conversationsRouter } from "@/backend/modules/conversations/routes";
import { customersRouter } from "@/backend/modules/customers/routes";
import { escalationsRouter } from "@/backend/modules/escalations/routes";
import { followUpsRouter } from "@/backend/modules/followups/routes";
import { leadsRouter } from "@/backend/modules/leads/routes";
import { messagesRouter } from "@/backend/modules/messages/routes";
import { ordersRouter } from "@/backend/modules/orders/routes";
import { paymentsRouter } from "@/backend/modules/payments/routes";
import { productsRouter } from "@/backend/modules/products/routes";
import { whatsappRouter } from "@/backend/modules/whatsapp/routes";
import { API_PATHS } from "@/backend/shared/constants/api-paths";

export function registerModuleRoutes(app: Express) {
  app.use(API_PATHS.whatsappWebhook, whatsappRouter);
  app.use(API_PATHS.customers, customersRouter);
  app.use(API_PATHS.conversations, conversationsRouter);
  app.use(API_PATHS.messages, messagesRouter);
  app.use(API_PATHS.leads, leadsRouter);
  app.use(API_PATHS.products, productsRouter);
  app.use(API_PATHS.orders, ordersRouter);
  app.use(API_PATHS.payments, paymentsRouter);
  app.use(API_PATHS.followUps, followUpsRouter);
  app.use(API_PATHS.escalations, escalationsRouter);
  app.use(API_PATHS.ai, aiRouter);
  app.use(API_PATHS.analytics, analyticsRouter);
}
