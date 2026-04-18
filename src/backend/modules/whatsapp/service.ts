import {
  BuyerType,
  ConversationChannel,
  ConversationStatus,
  LeadSource,
  LeadStage,
  LeadTemperature,
  MessageDirection,
  MessageSender,
  Prisma,
} from '@prisma/client';

import type { ParsedInboundWhatsAppMessage } from '@/backend/modules/whatsapp/provider';
import { logger } from '@/backend/shared/lib/logger';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

type InboundPersistenceResult =
  | {
      status: 'stored';
      customerId: string;
      conversationId: string;
      messageId: string;
      providerMessageId: string;
    }
  | {
      status: 'duplicate';
      customerId?: string;
      conversationId: string;
      messageId: string;
      providerMessageId: string;
    }
  | {
      status: 'ignored_empty_body';
      providerMessageId: string;
    };

function normalizeText(body: string) {
  return body.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function persistInboundWhatsAppMessage(
  message: ParsedInboundWhatsAppMessage
): Promise<InboundPersistenceResult> {
  const body = message.body?.trim() ?? '';

  if (!body) {
    logger.warn('whatsapp.inbound.ignored', {
      provider: message.provider,
      providerMessageId: message.providerMessageId,
      reason: 'empty_body',
    });

    return {
      status: 'ignored_empty_body',
      providerMessageId: message.providerMessageId,
    };
  }

  const prisma = getPrismaClient();

  const existingMessage = await prisma.message.findUnique({
    where: {
      providerMessageId: message.providerMessageId,
    },
    select: {
      id: true,
      conversationId: true,
      conversation: {
        select: {
          customerId: true,
        },
      },
    },
  });

  if (existingMessage) {
    logger.info('whatsapp.inbound.duplicate', {
      provider: message.provider,
      providerMessageId: message.providerMessageId,
      conversationId: existingMessage.conversationId,
    });

    return {
      status: 'duplicate',
      customerId: existingMessage.conversation.customerId,
      conversationId: existingMessage.conversationId,
      messageId: existingMessage.id,
      providerMessageId: message.providerMessageId,
    };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const currentCustomer = await tx.customer.findUnique({
        where: {
          phone: message.from,
        },
      });

      const customer =
        currentCustomer === null
          ? await tx.customer.create({
              data: {
                phone: message.from,
                name: message.profileName || message.from,
              },
            })
          : message.profileName && message.profileName !== currentCustomer.name
            ? await tx.customer.update({
                where: {
                  id: currentCustomer.id,
                },
                data: {
                  name: message.profileName,
                },
              })
            : currentCustomer;

      const activeConversation = await tx.conversation.findFirst({
        where: {
          customerId: customer.id,
          channel: ConversationChannel.WHATSAPP,
          status: {
            in: [ConversationStatus.OPEN, ConversationStatus.PENDING_HUMAN],
          },
        },
        orderBy: {
          updatedAt: 'desc',
        },
        include: {
          lead: {
            select: {
              id: true,
            },
          },
        },
      });

      const conversation =
        activeConversation ??
        (await tx.conversation.create({
          data: {
            customerId: customer.id,
            channel: ConversationChannel.WHATSAPP,
            status: ConversationStatus.OPEN,
            currentStage: LeadStage.NEW_INQUIRY,
            lastInboundAt: message.receivedAt,
          },
          include: {
            lead: {
              select: {
                id: true,
              },
            },
          },
        }));

      if (activeConversation) {
        await tx.conversation.update({
          where: {
            id: activeConversation.id,
          },
          data: {
            lastInboundAt: message.receivedAt,
          },
        });
      }

      const lead =
        conversation.lead ??
        (await tx.lead.create({
          data: {
            customerId: customer.id,
            conversationId: conversation.id,
            source: LeadSource.WHATSAPP,
            buyerType: BuyerType.UNCERTAIN,
            stage: LeadStage.NEW_INQUIRY,
            temperature: LeadTemperature.WARM,
          },
        }));

      const storedMessage = await tx.message.create({
        data: {
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
          rawText: body,
          normalizedText: normalizeText(body),
          sentBy: MessageSender.CUSTOMER,
          providerMessageId: message.providerMessageId,
          entitiesJson: {
            provider: message.provider,
            profileName: message.profileName,
            payload: message.rawPayload,
            leadId: lead.id,
          },
        },
      });

      logger.info('whatsapp.inbound.stored', {
        provider: message.provider,
        providerMessageId: message.providerMessageId,
        customerId: customer.id,
        conversationId: conversation.id,
        leadId: lead.id,
        messageId: storedMessage.id,
      });

      return {
        status: 'stored' as const,
        customerId: customer.id,
        conversationId: conversation.id,
        messageId: storedMessage.id,
        providerMessageId: message.providerMessageId,
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      const duplicateMessage = await prisma.message.findUnique({
        where: {
          providerMessageId: message.providerMessageId,
        },
        select: {
          id: true,
          conversationId: true,
          conversation: {
            select: {
              customerId: true,
            },
          },
        },
      });

      if (duplicateMessage) {
        logger.info('whatsapp.inbound.duplicate', {
          provider: message.provider,
          providerMessageId: message.providerMessageId,
          conversationId: duplicateMessage.conversationId,
          raceRecovered: true,
        });

        return {
          status: 'duplicate',
          customerId: duplicateMessage.conversation.customerId,
          conversationId: duplicateMessage.conversationId,
          messageId: duplicateMessage.id,
          providerMessageId: message.providerMessageId,
        };
      }
    }

    throw error;
  }
}
