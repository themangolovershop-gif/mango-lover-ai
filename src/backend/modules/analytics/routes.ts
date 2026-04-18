import {
  ExperimentStatus,
  ExperimentType,
  HumanCorrectionType,
  OrderStatus,
  OptimizationInsightStatus,
} from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { optimizationService } from '@/backend/modules/optimization/optimization.service';
import { optimizationTelemetryService } from '@/backend/modules/optimization/telemetry.service';
import { validateWithSchema } from '@/backend/shared/lib/http/validation';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

function toRecord<T extends string>(items: Array<{ key: T; count: number }>) {
  return items.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.key] = item.count;
    return accumulator;
  }, {});
}

const overviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

const insightsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const experimentParamsSchema = z.object({
  id: z.string().min(1),
});

const experimentBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.nativeEnum(ExperimentType),
  status: z.nativeEnum(ExperimentStatus).default(ExperimentStatus.DRAFT),
  variantA: z.record(z.any()),
  variantB: z.record(z.any()),
  audienceRuleJson: z.record(z.any()).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
});

const experimentUpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: z.nativeEnum(ExperimentStatus).optional(),
  variantA: z.record(z.any()).optional(),
  variantB: z.record(z.any()).optional(),
  audienceRuleJson: z.record(z.any()).nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  endedAt: z.string().datetime().nullable().optional(),
});

const humanFeedbackBodySchema = z.object({
  conversationId: z.string().min(1),
  customerId: z.string().min(1).nullable().optional(),
  messageId: z.string().min(1).nullable().optional(),
  aiSuggestionType: z.string().trim().min(1).max(200),
  aiSuggestedReply: z.string().trim().max(4000).nullable().optional(),
  humanFinalReply: z.string().trim().max(4000).nullable().optional(),
  correctionType: z.nativeEnum(HumanCorrectionType),
  reason: z.string().trim().max(500).nullable().optional(),
  metadata: z.record(z.any()).optional(),
});

export const analyticsRouter = Router();

analyticsRouter.get('/', async (_request, response) => {
  const prisma = getPrismaClient();

  const [
    customerCount,
    conversationStatusGroups,
    leadStageGroups,
    leadTemperatureGroups,
    orderStatusGroups,
    paymentStatusGroups,
    openEscalations,
    pendingFollowUps,
    confirmedRevenue,
    pipelineRevenue,
    openInsights,
    activeExperiments,
  ] = await Promise.all([
    prisma.customer.count(),
    prisma.conversation.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    }),
    prisma.lead.groupBy({
      by: ['stage'],
      _count: {
        _all: true,
      },
    }),
    prisma.lead.groupBy({
      by: ['temperature'],
      _count: {
        _all: true,
      },
    }),
    prisma.order.groupBy({
      by: ['status'],
      _count: {
        _all: true,
      },
    }),
    prisma.order.groupBy({
      by: ['paymentStatus'],
      _count: {
        _all: true,
      },
    }),
    prisma.escalation.count({
      where: {
        status: {
          in: ['OPEN', 'IN_REVIEW'],
        },
      },
    }),
    prisma.followUp.count({
      where: {
        status: 'PENDING',
      },
    }),
    prisma.order.aggregate({
      _sum: {
        totalAmount: true,
      },
      where: {
        status: {
          in: [
            OrderStatus.CONFIRMED,
            OrderStatus.PACKED,
            OrderStatus.DISPATCHED,
            OrderStatus.DELIVERED,
          ],
        },
      },
    }),
    prisma.order.aggregate({
      _sum: {
        totalAmount: true,
      },
      where: {
        status: {
          in: [
            OrderStatus.DRAFT,
            OrderStatus.PENDING_DETAILS,
            OrderStatus.PENDING_PAYMENT,
            OrderStatus.PAYMENT_UNDER_REVIEW,
          ],
        },
      },
    }),
    prisma.optimizationInsight.count({
      where: {
        status: {
          in: [OptimizationInsightStatus.OPEN, OptimizationInsightStatus.REVIEWED],
        },
      },
    }),
    prisma.experiment.count({
      where: {
        status: ExperimentStatus.ACTIVE,
      },
    }),
  ]);

  response.status(200).json({
    success: true,
    data: {
      customers: customerCount,
      conversationsByStatus: toRecord(
        conversationStatusGroups.map((item) => ({
          key: item.status,
          count: item._count._all,
        }))
      ),
      leadsByStage: toRecord(
        leadStageGroups.map((item) => ({
          key: item.stage,
          count: item._count._all,
        }))
      ),
      leadsByTemperature: toRecord(
        leadTemperatureGroups.map((item) => ({
          key: item.temperature,
          count: item._count._all,
        }))
      ),
      ordersByStatus: toRecord(
        orderStatusGroups.map((item) => ({
          key: item.status,
          count: item._count._all,
        }))
      ),
      ordersByPaymentStatus: toRecord(
        paymentStatusGroups.map((item) => ({
          key: item.paymentStatus,
          count: item._count._all,
        }))
      ),
      openEscalations,
      pendingFollowUps,
      confirmedRevenue: confirmedRevenue._sum.totalAmount,
      pipelineRevenue: pipelineRevenue._sum.totalAmount,
      openOptimizationInsights: openInsights,
      activeExperiments,
    },
  });
});

analyticsRouter.get('/optimization/overview', async (request, response) => {
  const query = validateWithSchema(overviewQuerySchema, request.query);
  const overview = await optimizationService.getDashboardSummary(query.days);

  response.status(200).json({
    success: true,
    data: overview,
  });
});

analyticsRouter.get('/optimization/insights', async (request, response) => {
  const query = validateWithSchema(insightsQuerySchema, request.query);
  const insights = await optimizationService.listInsights(query.limit);

  response.status(200).json({
    success: true,
    data: insights,
  });
});

analyticsRouter.get('/optimization/experiments', async (_request, response) => {
  const experiments = await optimizationService.listExperiments();

  response.status(200).json({
    success: true,
    data: experiments,
  });
});

analyticsRouter.post('/optimization/experiments', async (request, response) => {
  const body = validateWithSchema(experimentBodySchema, request.body);
  const experiment = await optimizationService.createExperiment({
    name: body.name,
    type: body.type,
    status: body.status,
    variantA: body.variantA,
    variantB: body.variantB,
    audienceRuleJson: body.audienceRuleJson,
    startedAt: body.startedAt ? new Date(body.startedAt) : null,
    endedAt: body.endedAt ? new Date(body.endedAt) : null,
  });

  response.status(201).json({
    success: true,
    data: experiment,
  });
});

analyticsRouter.patch('/optimization/experiments/:id', async (request, response) => {
  const params = validateWithSchema(experimentParamsSchema, request.params);
  const body = validateWithSchema(experimentUpdateBodySchema, request.body);
  const experiment = await optimizationService.updateExperiment(params.id, {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
    ...(body.variantA !== undefined ? { variantA: body.variantA } : {}),
    ...(body.variantB !== undefined ? { variantB: body.variantB } : {}),
    ...(body.audienceRuleJson !== undefined ? { audienceRuleJson: body.audienceRuleJson } : {}),
    ...(body.startedAt !== undefined ? { startedAt: body.startedAt ? new Date(body.startedAt) : null } : {}),
    ...(body.endedAt !== undefined ? { endedAt: body.endedAt ? new Date(body.endedAt) : null } : {}),
  });

  response.status(200).json({
    success: true,
    data: experiment,
  });
});

analyticsRouter.post('/optimization/human-feedback', async (request, response) => {
  const body = validateWithSchema(humanFeedbackBodySchema, request.body);
  const feedback = await optimizationTelemetryService.recordHumanFeedback({
    conversationId: body.conversationId,
    customerId: body.customerId ?? null,
    messageId: body.messageId ?? null,
    aiSuggestionType: body.aiSuggestionType,
    aiSuggestedReply: body.aiSuggestedReply ?? null,
    humanFinalReply: body.humanFinalReply ?? null,
    correctionType: body.correctionType,
    reason: body.reason ?? null,
    metadata: body.metadata,
  });

  response.status(201).json({
    success: true,
    data: feedback,
  });
});

analyticsRouter.post('/optimization/run', async (_request, response) => {
  const result = await optimizationService.runDailyOptimizationCycle();

  response.status(200).json({
    success: true,
    data: result,
  });
});
