import { FollowUpStatus, FollowUpType, Prisma } from '@prisma/client';

import { NotFoundError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

type DateInput = Date | string;

export type ListFollowUpsFilters = {
  leadId?: string;
  conversationId?: string;
  status?: FollowUpStatus;
  type?: FollowUpType;
  dueBefore?: DateInput;
  limit?: number;
};

export type ScheduleFollowUpInput = {
  leadId: string;
  conversationId: string;
  type: FollowUpType;
  reason: string;
  suggestedMessage?: string | null;
  scheduledAt: DateInput;
  result?: string | null;
  analyticsPayload?: Prisma.InputJsonValue;
};

export type UpdateFollowUpInput = {
  type?: FollowUpType;
  reason?: string;
  suggestedMessage?: string | null;
  scheduledAt?: DateInput;
  result?: string | null;
};

function hasOwnProperty<T extends object>(value: T, key: keyof T) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeText(value: string, fieldName: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new ValidationError(`${fieldName} is required.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeDate(value: DateInput, fieldName: string) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid date.`);
  }

  return date;
}

function buildFollowUpWhere(filters: ListFollowUpsFilters): Prisma.FollowUpWhereInput {
  return {
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.dueBefore
      ? {
          scheduledAt: {
            lte: normalizeDate(filters.dueBefore, 'dueBefore'),
          },
        }
      : {}),
  };
}

async function syncLeadNextFollowUpAtTx(tx: Prisma.TransactionClient, leadId: string) {
  const nextPendingFollowUp = await tx.followUp.findFirst({
    where: {
      leadId,
      status: FollowUpStatus.PENDING,
    },
    orderBy: {
      scheduledAt: 'asc',
    },
    select: {
      scheduledAt: true,
    },
  });

  await tx.lead.update({
    where: {
      id: leadId,
    },
    data: {
      nextFollowUpAt: nextPendingFollowUp?.scheduledAt ?? null,
    },
  });
}

export async function listFollowUps(filters: ListFollowUpsFilters = {}) {
  const prisma = getPrismaClient();

  return prisma.followUp.findMany({
    where: buildFollowUpWhere(filters),
    orderBy: {
      scheduledAt: 'asc',
    },
    take: filters.limit ?? 100,
  });
}

export async function getFollowUpById(followUpId: string) {
  const prisma = getPrismaClient();
  const followUp = await prisma.followUp.findUnique({
    where: {
      id: followUpId,
    },
  });

  if (!followUp) {
    throw new NotFoundError(`Follow-up ${followUpId} was not found.`);
  }

  return followUp;
}

export async function listDueFollowUps(asOf: DateInput = new Date(), limit = 50) {
  return listFollowUps({
    status: FollowUpStatus.PENDING,
    dueBefore: asOf,
    limit,
  });
}

export async function scheduleFollowUp(input: ScheduleFollowUpInput) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: {
        id: input.leadId,
      },
      select: {
        customerId: true,
      },
    });
    const followUp = await tx.followUp.create({
      data: {
        leadId: input.leadId,
        conversationId: input.conversationId,
        type: input.type,
        reason: normalizeText(input.reason, 'reason'),
        suggestedMessage: normalizeOptionalText(input.suggestedMessage),
        scheduledAt: normalizeDate(input.scheduledAt, 'scheduledAt'),
        result: input.result ?? null,
      },
    });

    const delayHours = Math.max(
      0,
      Math.round(
        (followUp.scheduledAt.getTime() - followUp.createdAt.getTime()) / (1000 * 60 * 60)
      )
    );

    await tx.analyticsEvent.create({
      data: {
        customerId: lead?.customerId ?? null,
        conversationId: input.conversationId,
        leadId: input.leadId,
        eventType: 'follow_up_scheduled',
        payloadJson: {
          followUpId: followUp.id,
          type: input.type,
          reason: normalizeText(input.reason, 'reason'),
          delayHours,
          ...(input.analyticsPayload && typeof input.analyticsPayload === 'object' && !Array.isArray(input.analyticsPayload)
            ? (input.analyticsPayload as Prisma.InputJsonObject)
            : {}),
        } satisfies Prisma.InputJsonObject,
      },
    });

    await syncLeadNextFollowUpAtTx(tx, input.leadId);

    return followUp;
  });
}

export async function updateFollowUp(followUpId: string, input: UpdateFollowUpInput) {
  const prisma = getPrismaClient();
  const currentFollowUp = await getFollowUpById(followUpId);

  if (currentFollowUp.status !== FollowUpStatus.PENDING) {
    throw new ValidationError('Only pending follow-ups can be edited.');
  }

  return prisma.$transaction(async (tx) => {
    const data: Prisma.FollowUpUpdateInput = {};

    if (input.type !== undefined) {
      data.type = input.type;
    }

    if (input.reason !== undefined) {
      data.reason = normalizeText(input.reason, 'reason');
    }

    if (hasOwnProperty(input, 'suggestedMessage')) {
      data.suggestedMessage = normalizeOptionalText(input.suggestedMessage);
    }

    if (input.scheduledAt !== undefined) {
      data.scheduledAt = normalizeDate(input.scheduledAt, 'scheduledAt');
    }

    if (hasOwnProperty(input, 'result')) {
      data.result = input.result ?? null;
    }

    const followUp = await tx.followUp.update({
      where: {
        id: followUpId,
      },
      data,
    });

    await syncLeadNextFollowUpAtTx(tx, currentFollowUp.leadId);

    return followUp;
  });
}

export async function markFollowUpSent(followUpId: string, result?: string | null) {
  const prisma = getPrismaClient();
  const currentFollowUp = await getFollowUpById(followUpId);

  if (currentFollowUp.status === FollowUpStatus.SENT) {
    return currentFollowUp;
  }

  if (currentFollowUp.status !== FollowUpStatus.PENDING) {
    throw new ValidationError('Only pending follow-ups can be marked as sent.');
  }

  return prisma.$transaction(async (tx) => {
    const sentAt = new Date();
    const followUp = await tx.followUp.update({
      where: {
        id: followUpId,
      },
      data: {
        status: FollowUpStatus.SENT,
        sentAt,
        result: result ?? currentFollowUp.result ?? null,
      },
    });

    await tx.lead.update({
      where: {
        id: currentFollowUp.leadId,
      },
      data: {
        lastFollowUpAt: sentAt,
        followUpCount: {
          increment: 1,
        },
      },
    });

    await syncLeadNextFollowUpAtTx(tx, currentFollowUp.leadId);

    return followUp;
  });
}

export async function markFollowUpFailed(followUpId: string, result: string) {
  const prisma = getPrismaClient();
  const currentFollowUp = await getFollowUpById(followUpId);

  if (currentFollowUp.status === FollowUpStatus.FAILED) {
    return currentFollowUp;
  }

  if (currentFollowUp.status !== FollowUpStatus.PENDING) {
    throw new ValidationError('Only pending follow-ups can be marked as failed.');
  }

  return prisma.$transaction(async (tx) => {
    const followUp = await tx.followUp.update({
      where: {
        id: followUpId,
      },
      data: {
        status: FollowUpStatus.FAILED,
        result: normalizeText(result, 'result'),
      },
    });

    await syncLeadNextFollowUpAtTx(tx, currentFollowUp.leadId);

    return followUp;
  });
}

export async function cancelFollowUp(followUpId: string, result?: string | null) {
  const prisma = getPrismaClient();
  const currentFollowUp = await getFollowUpById(followUpId);

  if (currentFollowUp.status === FollowUpStatus.CANCELLED) {
    return currentFollowUp;
  }

  if (currentFollowUp.status !== FollowUpStatus.PENDING) {
    throw new ValidationError('Only pending follow-ups can be cancelled.');
  }

  return prisma.$transaction(async (tx) => {
    const followUp = await tx.followUp.update({
      where: {
        id: followUpId,
      },
      data: {
        status: FollowUpStatus.CANCELLED,
        result: result ?? currentFollowUp.result ?? null,
      },
    });

    await syncLeadNextFollowUpAtTx(tx, currentFollowUp.leadId);

    return followUp;
  });
}

export async function cancelPendingFollowUpsForConversation(
  conversationId: string,
  result?: string | null
) {
  const prisma = getPrismaClient();
  const pendingFollowUps = await prisma.followUp.findMany({
    where: {
      conversationId,
      status: FollowUpStatus.PENDING,
    },
    select: {
      id: true,
    },
  });

  const cancelled = [];

  for (const followUp of pendingFollowUps) {
    cancelled.push(await cancelFollowUp(followUp.id, result));
  }

  return cancelled;
}
