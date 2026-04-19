import {
  ConversationStatus,
  EscalationStatus,
  FollowUpStatus,
  MessageSender,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  type Message,
} from '@prisma/client';

import { aiReplyService } from '@/backend/modules/ai/reply.service';
import { responseGroundingService } from '@/backend/modules/ai/response-grounding.service';
import { masterAgent } from '@/backend/modules/agents/master-agent.service';
import type { ExtractedEntities } from '@/backend/modules/ai/entity.service';
import { decideNextAction } from '@/backend/modules/ai/nba.service';
import { extractEntities } from '@/backend/modules/ai/entity.service';
import { detectIntents, type IntentType } from '@/backend/modules/ai/intent.service';
import { cancelPendingFollowUpsForConversation, scheduleFollowUp } from '@/backend/modules/followups/follow-up.service';
import { detectBuyerType } from '@/backend/modules/leads/buyer-type.service';
import { calculateLeadScore, getLeadTemperature } from '@/backend/modules/leads/scoring.service';
import { determineLeadStage, mapPrismaLeadStageToDerived } from '@/backend/modules/leads/stage.service';
import {
  buildPersonalizedFollowUpMessage,
  syncCustomerMemoryContext,
} from '@/backend/modules/memory/memory.service';
import { optimizationTelemetryService } from '@/backend/modules/optimization/telemetry.service';
import { createOrder, getLatestConversationOrder, updateOrder } from '@/backend/modules/orders/order.service';
import { createPayment } from '@/backend/modules/payments/payment.service';
import { getActiveProductBySize } from '@/backend/modules/products/product.service';
import { mapSizeToProductSize } from '@/backend/modules/products/product-helpers';
import { createEscalation } from '@/backend/modules/escalations/escalation.service';
import { persistInboundWhatsAppMessage } from '@/backend/modules/whatsapp/service';
import { sendOutboundWhatsAppMessage } from '@/backend/modules/whatsapp/outbound.service';
import type { ParsedInboundWhatsAppMessage } from '@/backend/modules/whatsapp/provider';
import {
  buildOrderSummary,
  determineEscalationPlan,
  determineFollowUpPlan,
  mapBuyerTypeToPrisma,
  mapLeadStageToPrisma,
  mapLeadTemperatureToPrisma,
} from '@/backend/modules/whatsapp/message-orchestrator.helpers';
import { logger } from '@/backend/shared/lib/logger';
import { getPrismaClient } from '@/backend/shared/lib/prisma';
import { normalizeMessage } from '@/backend/shared/utils/normalization';

type ConversationOrder = Awaited<ReturnType<typeof getLatestConversationOrder>>;

type InboundProcessingResult =
  | {
      status: 'replied';
      conversationId: string;
      inboundMessageId: string;
      outboundMessageId: string;
      providerMessageId: string | null;
      nextAction: string;
    }
  | {
      status: 'duplicate' | 'ignored_empty_body';
      conversationId?: string;
      inboundMessageId?: string;
      providerMessageId: string;
    };

function dedupeIntents(primaryIntent: IntentType, secondaryIntents: IntentType[]) {
  return Array.from(new Set([primaryIntent, ...secondaryIntents]));
}

function buildRecentHistory(messages: Message[]) {
  return messages
    .map((message) => {
      const speaker =
        message.direction === 'INBOUND'
          ? 'Customer'
          : message.sentBy === 'HUMAN'
            ? 'Team'
            : 'Assistant';

      return `${speaker}: ${message.rawText}`;
    })
    .join('\n');
}

function getLatestUserMessage(messages: Message[]) {
  const latestInbound = [...messages]
    .reverse()
    .find((message) => message.direction === 'INBOUND');

  return latestInbound?.rawText ?? undefined;
}

function getLastAssistantReply(messages: Message[]) {
  const latestAssistant = [...messages]
    .reverse()
    .find(
      (message) => message.direction === 'OUTBOUND' && message.sentBy === MessageSender.AI
    );

  return latestAssistant?.rawText ?? undefined;
}

function getRecentAssistantReplies(messages: Message[], limit = 3) {
  return [...messages]
    .filter(
      (message) =>
        message.direction === 'OUTBOUND' &&
        (message.sentBy === MessageSender.AI || message.sentBy === MessageSender.SYSTEM)
    )
    .slice(-limit)
    .map((message) => message.rawText);
}

function isMutableOrderStatus(status: OrderStatus) {
  const mutableStatuses: OrderStatus[] = [
    OrderStatus.DRAFT,
    OrderStatus.AWAITING_CONFIRMATION,
  ];

  return mutableStatuses.includes(status);
}

function serializeEntities(entities: ExtractedEntities): Prisma.InputJsonObject {
  return {
    ...(entities.quantityDozen !== undefined ? { quantityDozen: entities.quantityDozen } : {}),
    ...(entities.size !== undefined ? { size: entities.size } : {}),
    ...(entities.city !== undefined ? { city: entities.city } : {}),
    ...(entities.pinCode !== undefined ? { pinCode: entities.pinCode } : {}),
    ...(entities.addressText !== undefined ? { addressText: entities.addressText } : {}),
    ...(entities.customerName !== undefined ? { customerName: entities.customerName } : {}),
    ...(entities.phone !== undefined ? { phone: entities.phone } : {}),
    ...(entities.paymentMentioned !== undefined
      ? { paymentMentioned: entities.paymentMentioned }
      : {}),
    ...(entities.urgency !== undefined ? { urgency: entities.urgency } : {}),
    ...(entities.gifting !== undefined ? { gifting: entities.gifting } : {}),
  };
}

function createLeadTagsPayload(args: {
  intents: IntentType[];
  entities: ExtractedEntities;
  nextAction: string;
}): Prisma.InputJsonObject {
  return {
    intents: args.intents,
    entities: serializeEntities(args.entities),
    nextAction: args.nextAction,
  };
}

function createAnalyticsPayload(args: {
  normalizedText: string;
  intents: IntentType[];
  entities: ExtractedEntities;
  nextAction: string;
  leadScore: number;
}): Prisma.InputJsonObject {
  return {
    normalizedText: args.normalizedText,
    intents: args.intents,
    entities: serializeEntities(args.entities),
    nextAction: args.nextAction,
    leadScore: args.leadScore,
  };
}

async function syncDraftOrderFromEntities(args: {
  conversationId: string;
  customerId: string;
  leadId: string;
  latestOrder: ConversationOrder | null;
  size?: string | null;
  quantityDozen?: number;
}) {
  const targetProductSize = mapSizeToProductSize(args.size);
  const existingItem = args.latestOrder?.items[0];
  const effectiveQuantity = args.quantityDozen ?? existingItem?.quantity ?? null;
  const effectiveProduct =
    targetProductSize !== null
      ? await getActiveProductBySize(targetProductSize)
      : existingItem
        ? { id: existingItem.productId }
        : null;

  if (!effectiveProduct || effectiveQuantity === null) {
    return args.latestOrder;
  }

  if (args.latestOrder) {
    return updateOrder(args.latestOrder.id, {
      items: [
        {
          productId: effectiveProduct.id,
          quantity: effectiveQuantity,
        },
      ],
    });
  }

  return createOrder({
    customerId: args.customerId,
    conversationId: args.conversationId,
    leadId: args.leadId,
    items: [
      {
        productId: effectiveProduct.id,
        quantity: effectiveQuantity,
      },
    ],
  });
}

export async function processInboundWhatsAppMessage(
  inboundMessage: ParsedInboundWhatsAppMessage
): Promise<InboundProcessingResult> {
  const persistenceResult = await persistInboundWhatsAppMessage(inboundMessage);

  if (persistenceResult.status !== 'stored') {
    return {
      status: persistenceResult.status,
      conversationId:
        'conversationId' in persistenceResult ? persistenceResult.conversationId : undefined,
      inboundMessageId: 'messageId' in persistenceResult ? persistenceResult.messageId : undefined,
      providerMessageId: persistenceResult.providerMessageId,
    };
  }

  const prisma = getPrismaClient();
  const normalizedText = normalizeMessage(inboundMessage.body ?? '');

  const conversation = await prisma.conversation.findUnique({
    where: {
      id: persistenceResult.conversationId,
    },
    include: {
      customer: true,
      lead: true,
      messages: {
        orderBy: {
          createdAt: 'desc',
        },
        take: 8,
      },
      followUps: {
        where: {
          status: FollowUpStatus.PENDING,
        },
        select: {
          id: true,
        },
      },
    },
  });

  if (!conversation || !conversation.lead) {
    throw new Error('Conversation or lead missing after inbound persistence.');
  }

  const intentsResult = detectIntents(normalizedText);
  const intents = dedupeIntents(intentsResult.primaryIntent, intentsResult.secondaryIntents);
  const entities = extractEntities(normalizedText);
  
  console.log(`[DEBUG] Inbound: "${normalizedText}"`);
  console.log(`[DEBUG] Intents:`, intents);
  console.log(`[DEBUG] Entities:`, entities);

  const leadScore = calculateLeadScore(
    intentsResult.secondaryIntents.concat(intentsResult.primaryIntent),
    entities
  );
  const buyerType = detectBuyerType({
    intents,
    entities,
    isRepeatBuyer: conversation.customer.isRepeatBuyer,
  });

  await cancelPendingFollowUpsForConversation(
    conversation.id,
    'Cancelled because customer replied on WhatsApp.'
  );

  await optimizationTelemetryService.recordOutcome({
    customerId: conversation.customerId,
    conversationId: conversation.id,
    leadId: conversation.lead.id,
    orderId: null,
    label: 'engaged',
    payload: {
      source: 'inbound_whatsapp_message',
    },
  });

  if (conversation.followUps.length > 0) {
    await optimizationTelemetryService.recordOutcome({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      orderId: null,
      label: 'follow_up_replied',
      payload: {
        pendingFollowUpsCancelled: conversation.followUps.length,
      },
    });
  }

  if (entities.city || entities.pinCode) {
    await prisma.customer.update({
      where: {
        id: conversation.customerId,
      },
      data: {
        city: entities.city ?? conversation.customer.city,
        pinCode: entities.pinCode ?? conversation.customer.pinCode,
      },
    });
  }

  let latestOrder = await getLatestConversationOrder(conversation.id);

  if (
    latestOrder &&
    (intents.includes('restart_order_request') || intents.includes('cancellation')) &&
    isMutableOrderStatus(latestOrder.status)
  ) {
    await updateOrder(latestOrder.id, {
      status: OrderStatus.CANCELLED,
      notes: latestOrder.notes
        ? `${latestOrder.notes}\nRestarted from WhatsApp conversation.`
        : 'Restarted from WhatsApp conversation.',
    });

    latestOrder = null;
  }

  if (entities.size || entities.quantityDozen) {
    latestOrder = await syncDraftOrderFromEntities({
      conversationId: conversation.id,
      customerId: conversation.customerId,
      leadId: conversation.lead.id,
      latestOrder,
      size: entities.size,
      quantityDozen: entities.quantityDozen,
    });
  }

  if (entities.paymentMentioned && latestOrder && latestOrder.paymentStatus === PaymentStatus.UNPAID) {
    await createPayment({
      orderId: latestOrder.id,
      amount: latestOrder.totalAmount,
      method: PaymentMethod.UPI,
      status: PaymentStatus.SUBMITTED,
      reference: inboundMessage.body,
      paidAt: new Date(),
    });

    latestOrder = await getLatestConversationOrder(conversation.id);
  }

  const leadStage = determineLeadStage({
    currentStage: mapPrismaLeadStageToDerived(conversation.lead.stage),
    intents,
    entities,
    score: leadScore,
    hasOrder: !!latestOrder,
    paymentStatus: latestOrder?.paymentStatus ?? PaymentStatus.UNPAID,
  });
  const nextAction = decideNextAction({
    leadStage,
    intents,
    entities,
    hasOrder: !!latestOrder,
    paymentStatus: latestOrder?.paymentStatus ?? PaymentStatus.UNPAID,
  });
  const escalationPlan = determineEscalationPlan({
    intents,
    buyerType,
    nextAction,
  });
  const needsHuman = escalationPlan !== null;

  const temperature = getLeadTemperature(leadScore);

  await prisma.lead.update({
    where: {
      id: conversation.lead.id,
    },
    data: {
      buyerType: mapBuyerTypeToPrisma(buyerType),
      stage: mapLeadStageToPrisma(leadStage),
      score: leadScore,
      temperature: mapLeadTemperatureToPrisma(temperature),
      needsHuman,
      tagsJson: createLeadTagsPayload({
        intents,
        entities,
        nextAction,
      }),
      escalationReason: escalationPlan?.reason ?? null,
    },
  });

  await prisma.conversation.update({
    where: {
      id: conversation.id,
    },
    data: {
      currentStage: mapLeadStageToPrisma(leadStage),
      status: needsHuman ? ConversationStatus.PENDING_HUMAN : ConversationStatus.OPEN,
      summary: `${leadStage} / ${buyerType} / ${nextAction}`,
    },
  });

  if (escalationPlan) {
    const existingEscalation = await prisma.escalation.findFirst({
      where: {
        leadId: conversation.lead.id,
        type: escalationPlan.type,
        status: {
          in: [EscalationStatus.OPEN, EscalationStatus.IN_REVIEW],
        },
      },
      select: {
        id: true,
      },
    });

    if (!existingEscalation) {
      await createEscalation({
        leadId: conversation.lead.id,
        conversationId: conversation.id,
        customerId: conversation.customerId,
        type: escalationPlan.type,
        severity: escalationPlan.severity,
        reason: escalationPlan.reason,
      });
    }

    await optimizationTelemetryService.recordOutcome({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      orderId: latestOrder?.id ?? null,
      label: 'escalated_to_human',
      payload: {
        escalationType: escalationPlan.type,
        reason: escalationPlan.reason,
      },
    });
  }

  await prisma.analyticsEvent.create({
    data: {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      orderId: latestOrder?.id ?? null,
      eventType: 'inbound_message_processed',
      payloadJson: createAnalyticsPayload({
        normalizedText,
        intents,
        entities,
        nextAction,
        leadScore,
      }),
    },
  });

  const freshMessages = [...conversation.messages].reverse();
  const latestUserMessage = getLatestUserMessage(freshMessages);
  const lastAssistantReply = getLastAssistantReply(freshMessages);
  const recentAssistantReplies = getRecentAssistantReplies(freshMessages);
  let memorySnapshot: Awaited<ReturnType<typeof syncCustomerMemoryContext>> | null = null;

  try {
    memorySnapshot = await syncCustomerMemoryContext({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      customerName: conversation.customer.name,
      phone: conversation.customer.phone,
      leadStage,
      buyerType,
      leadScore,
      intents,
      nextAction,
      latestOrder,
      latestUserMessage,
      lastAssistantReply,
    });
  } catch (error) {
    logger.warn('memory.context.unavailable', {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  let groundingSnapshot: Awaited<ReturnType<typeof responseGroundingService.buildGroundingContext>> | null = null;

  try {
    groundingSnapshot = await responseGroundingService.buildGroundingContext({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      phone: conversation.customer.phone,
      leadStage,
      buyerType,
      nextAction,
      intents,
      entities,
      latestUserMessage: latestUserMessage ?? inboundMessage.body ?? '',
      latestOrder,
      paymentStatus: latestOrder?.paymentStatus ?? PaymentStatus.UNPAID,
      memorySnapshot,
    });
  } catch (error) {
    logger.warn('grounding.context.unavailable', {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  let agentSnapshot: Awaited<ReturnType<typeof masterAgent.process>> | null = null;

  try {
    agentSnapshot = await masterAgent.process({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      customerName: conversation.customer.name,
      phone: conversation.customer.phone,
      latestMessage: latestUserMessage ?? inboundMessage.body ?? '',
      recentHistory: buildRecentHistory(freshMessages),
      lastAssistantReply,
      recentAssistantReplies,
      intents,
      primaryIntent: intents[0] ?? 'unknown',
      entities,
      leadStage,
      buyerType,
      nextAction,
      latestOrder,
      orderSummary: buildOrderSummary(latestOrder),
      memorySnapshot,
      groundingSnapshot,
    });
  } catch (error) {
    logger.warn('agents.context.unavailable', {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  let replyStrategySelection: Awaited<
    ReturnType<typeof optimizationTelemetryService.selectReplyStrategyContext>
  > | null = null;

  try {
    replyStrategySelection = await optimizationTelemetryService.selectReplyStrategyContext({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      latestMessage: latestUserMessage ?? inboundMessage.body ?? '',
      leadStage,
      buyerType,
      intents,
      primaryIntent: intents[0] ?? 'unknown',
      nextAction,
      entities,
      memorySnapshot,
      groundingSnapshot,
      agentSnapshot,
    });
  } catch (error) {
    logger.warn('optimization.reply_strategy.unavailable', {
      customerId: conversation.customerId,
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }

  const replyText = await aiReplyService.generateReply({
    customerName: conversation.customer.name,
    phone: conversation.customer.phone,
    leadStage,
    buyerType,
    intents,
    entities,
    nextAction,
    orderSummary: buildOrderSummary(latestOrder),
    latestUserMessage,
    lastAssistantReply,
    recentAssistantReplies,
    recentHistory: buildRecentHistory(freshMessages),
    customerMemoryProfile: memorySnapshot?.profile,
    salesMemory: memorySnapshot?.sales,
    sessionMemory: memorySnapshot?.session,
    personalization: memorySnapshot?.personalization,
    conversationSummary: memorySnapshot?.conversationSummary,
    toolPlanSummary: groundingSnapshot?.toolPlanSummary,
    toolResults: groundingSnapshot?.toolResults,
    groundedReplyHint: agentSnapshot?.responseText ?? groundingSnapshot?.groundedReplyHint,
    groundingRules: groundingSnapshot?.groundingRules,
    agentDecisionReason: agentSnapshot?.decision.reason,
    agentSummaries: agentSnapshot?.results.map(
      (result) => `${result.agent}: ${result.summary}`
    ),
    optimizationHints: replyStrategySelection?.optimizationHints,
  });

  const outboundResult = await sendOutboundWhatsAppMessage({
    conversationId: conversation.id,
    body: replyText,
    sentBy: MessageSender.AI,
    detectedIntent: nextAction,
    confidence: intentsResult.confidence,
    entitiesJson: createLeadTagsPayload({
      intents,
      entities,
      nextAction,
    }),
  });

  if (replyStrategySelection) {
    await optimizationTelemetryService.recordReplyStrategyUsage({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      leadId: conversation.lead.id,
      orderId: latestOrder?.id ?? null,
      phone: conversation.customer.phone,
      replyText,
      providerMessageId: outboundResult.providerMessageId,
      selection: replyStrategySelection,
    });
  }

  const followUpPlan = determineFollowUpPlan({
    leadStage,
    nextAction,
    needsHuman,
  });

  if (followUpPlan) {
    const existingPending = await prisma.followUp.findFirst({
      where: {
        leadId: conversation.lead.id,
        status: FollowUpStatus.PENDING,
      },
      select: {
        id: true,
      },
    });

    if (!existingPending) {
      const followUpOptimization = replyStrategySelection
        ? await optimizationTelemetryService.selectFollowUpOptimization({
            customerId: conversation.customerId,
            conversationId: conversation.id,
            leadId: conversation.lead.id,
            followUpType: followUpPlan.type,
            leadStage,
            buyerSegment: replyStrategySelection.buyerSegment,
            reason: followUpPlan.reason,
          })
        : null;
      const scheduledAt = new Date();
      scheduledAt.setHours(
        scheduledAt.getHours() +
          (followUpOptimization?.delayHoursOverride ?? followUpPlan.delayHours)
      );

      await scheduleFollowUp({
        leadId: conversation.lead.id,
        conversationId: conversation.id,
        type: followUpPlan.type,
        reason: followUpPlan.reason,
        suggestedMessage: memorySnapshot
          ? buildPersonalizedFollowUpMessage({
              followUpType: followUpPlan.type,
              profile: memorySnapshot.profile,
              personalization: memorySnapshot.personalization,
              session: memorySnapshot.session,
            })
          : undefined,
        scheduledAt,
        analyticsPayload: {
          strategyName: replyStrategySelection?.strategyName ?? null,
          buyerSegment: replyStrategySelection?.buyerSegment ?? null,
          ...(followUpOptimization?.analyticsPayload ?? {}),
        } satisfies Prisma.InputJsonObject,
      });
    }
  }

  logger.info('whatsapp.inbound.orchestrated', {
    conversationId: conversation.id,
    inboundMessageId: persistenceResult.messageId,
    outboundMessageId: outboundResult.message.id,
    nextAction,
  });

  return {
    status: 'replied',
    conversationId: conversation.id,
    inboundMessageId: persistenceResult.messageId,
    outboundMessageId: outboundResult.message.id,
    providerMessageId: outboundResult.providerMessageId,
    nextAction,
  };
}
