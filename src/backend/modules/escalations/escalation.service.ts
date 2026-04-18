import {
  ConversationStatus,
  EscalationSeverity,
  EscalationStatus,
  EscalationType,
  Prisma,
} from '@prisma/client';

import { NotFoundError, ValidationError } from '@/backend/shared/lib/errors/app-error';
import { getPrismaClient } from '@/backend/shared/lib/prisma';

export type ListEscalationsFilters = {
  leadId?: string;
  conversationId?: string;
  customerId?: string;
  status?: EscalationStatus;
  severity?: EscalationSeverity;
  type?: EscalationType;
  limit?: number;
};

export type CreateEscalationInput = {
  leadId: string;
  conversationId: string;
  customerId: string;
  type: EscalationType;
  severity: EscalationSeverity;
  reason: string;
  status?: EscalationStatus;
  resolutionNotes?: string | null;
  assignedTo?: string | null;
};

export type UpdateEscalationInput = {
  type?: EscalationType;
  severity?: EscalationSeverity;
  status?: EscalationStatus;
  reason?: string;
  resolutionNotes?: string | null;
  assignedTo?: string | null;
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

function buildEscalationWhere(filters: ListEscalationsFilters): Prisma.EscalationWhereInput {
  return {
    ...(filters.leadId ? { leadId: filters.leadId } : {}),
    ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.type ? { type: filters.type } : {}),
  };
}

async function syncEscalationStateTx(
  tx: Prisma.TransactionClient,
  input: {
    leadId: string;
    conversationId: string;
  }
) {
  const activeEscalations = await tx.escalation.findMany({
    where: {
      leadId: input.leadId,
      status: {
        in: [EscalationStatus.OPEN, EscalationStatus.IN_REVIEW],
      },
    },
    orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
  });

  if (activeEscalations.length > 0) {
    await tx.lead.update({
      where: {
        id: input.leadId,
      },
      data: {
        needsHuman: true,
        escalationReason: activeEscalations[0].reason,
      },
    });

    await tx.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: ConversationStatus.PENDING_HUMAN,
      },
    });

    return;
  }

  await tx.lead.update({
    where: {
      id: input.leadId,
    },
    data: {
      needsHuman: false,
      escalationReason: null,
    },
  });

  const conversation = await tx.conversation.findUnique({
    where: {
      id: input.conversationId,
    },
    select: {
      status: true,
    },
  });

  if (conversation?.status === ConversationStatus.PENDING_HUMAN) {
    await tx.conversation.update({
      where: {
        id: input.conversationId,
      },
      data: {
        status: ConversationStatus.OPEN,
      },
    });
  }
}

export async function listEscalations(filters: ListEscalationsFilters = {}) {
  const prisma = getPrismaClient();

  return prisma.escalation.findMany({
    where: buildEscalationWhere(filters),
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: filters.limit ?? 100,
  });
}

export async function getEscalationById(escalationId: string) {
  const prisma = getPrismaClient();
  const escalation = await prisma.escalation.findUnique({
    where: {
      id: escalationId,
    },
  });

  if (!escalation) {
    throw new NotFoundError(`Escalation ${escalationId} was not found.`);
  }

  return escalation;
}

export async function createEscalation(input: CreateEscalationInput) {
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const escalation = await tx.escalation.create({
      data: {
        leadId: input.leadId,
        conversationId: input.conversationId,
        customerId: input.customerId,
        type: input.type,
        severity: input.severity,
        status: input.status ?? EscalationStatus.OPEN,
        reason: normalizeText(input.reason, 'reason'),
        resolutionNotes: input.resolutionNotes ?? null,
        assignedTo: input.assignedTo ?? null,
      },
    });

    await syncEscalationStateTx(tx, {
      leadId: escalation.leadId,
      conversationId: escalation.conversationId,
    });

    return escalation;
  });
}

export async function updateEscalation(
  escalationId: string,
  input: UpdateEscalationInput
) {
  const prisma = getPrismaClient();
  const currentEscalation = await getEscalationById(escalationId);

  return prisma.$transaction(async (tx) => {
    const data: Prisma.EscalationUpdateInput = {};

    if (input.type !== undefined) {
      data.type = input.type;
    }

    if (input.severity !== undefined) {
      data.severity = input.severity;
    }

    if (input.status !== undefined) {
      data.status = input.status;
    }

    if (input.reason !== undefined) {
      data.reason = normalizeText(input.reason, 'reason');
    }

    if (hasOwnProperty(input, 'resolutionNotes')) {
      data.resolutionNotes = input.resolutionNotes ?? null;
    }

    if (hasOwnProperty(input, 'assignedTo')) {
      data.assignedTo = input.assignedTo ?? null;
    }

    const escalation = await tx.escalation.update({
      where: {
        id: escalationId,
      },
      data,
    });

    await syncEscalationStateTx(tx, {
      leadId: currentEscalation.leadId,
      conversationId: currentEscalation.conversationId,
    });

    return escalation;
  });
}

export async function resolveEscalation(
  escalationId: string,
  resolutionNotes?: string | null
) {
  return updateEscalation(escalationId, {
    status: EscalationStatus.RESOLVED,
    resolutionNotes: resolutionNotes ?? null,
  });
}
