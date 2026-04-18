import { MessageDirection, MessageSender, Prisma } from '@prisma/client';

import { getConfiguredWhatsAppProvider } from '@/backend/modules/whatsapp/twilio-provider';
import { NotFoundError } from '@/backend/shared/lib/errors/app-error';
import { logger } from '@/backend/shared/lib/logger';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

type SendOutboundWhatsAppMessageInput = {
  conversationId: string;
  body: string;
  sentBy: MessageSender;
  phone?: string;
  detectedIntent?: string | null;
  confidence?: number | null;
  entitiesJson?: Prisma.InputJsonValue;
};

function normalizeMessageText(body: string) {
  return body.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function sendOutboundWhatsAppMessage(
  input: SendOutboundWhatsAppMessageInput
) {
  const prisma = getPrismaClient();
  const conversation = await prisma.conversation.findUnique({
    where: {
      id: input.conversationId,
    },
    include: {
      customer: true,
    },
  });

  if (!conversation) {
    throw new NotFoundError(`Conversation ${input.conversationId} was not found.`);
  }

  const provider = getConfiguredWhatsAppProvider();
  const targetPhone = input.phone ?? conversation.customer.phone;
  const providerResult = await provider.sendTextMessage({
    to: targetPhone,
    body: input.body,
  });

  const message = await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      direction: MessageDirection.OUTBOUND,
      rawText: input.body.trim(),
      normalizedText: normalizeMessageText(input.body),
      detectedIntent: input.detectedIntent ?? undefined,
      confidence: input.confidence ?? undefined,
      entitiesJson: input.entitiesJson,
      sentBy: input.sentBy,
      providerMessageId: providerResult.providerMessageId,
    },
  });

  await prisma.conversation.update({
    where: {
      id: input.conversationId,
    },
    data: {
      lastOutboundAt: new Date(),
    },
  });

  logger.info('whatsapp.outbound.persisted', {
    conversationId: input.conversationId,
    messageId: message.id,
    sentBy: input.sentBy,
    providerMessageId: providerResult.providerMessageId,
  });

  return {
    conversation,
    message,
    providerMessageId: providerResult.providerMessageId,
  };
}
