import { FollowUpStatus, FollowUpType } from "@prisma/client";
import { NextResponse } from "next/server";

import { listFollowUps, scheduleFollowUp } from "@/backend/modules/followups/follow-up.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapFollowUpStatus(status: FollowUpStatus) {
  switch (status) {
    case FollowUpStatus.PENDING:
      return "pending";
    case FollowUpStatus.SENT:
      return "sent";
    case FollowUpStatus.CANCELLED:
      return "cancelled";
    case FollowUpStatus.FAILED:
      return "cancelled";
    default:
      return "pending";
  }
}

async function mapFollowUps(conversationId?: string) {
  const prisma = getPrismaClient();
  const followUps = await listFollowUps({
    ...(conversationId ? { conversationId } : {}),
  });

  const conversationIds = Array.from(new Set(followUps.map((followUp) => followUp.conversationId)));
  const conversations = conversationIds.length
    ? await prisma.conversation.findMany({
        where: {
          id: {
            in: conversationIds,
          },
        },
        include: {
          customer: true,
        },
      })
    : [];
  const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation]));

  return followUps.map((followUp) => {
    const conversation = conversationMap.get(followUp.conversationId);

    return {
      id: followUp.id,
      conversation_id: followUp.conversationId,
      phone: conversation?.customer.phone ?? "",
      message: followUp.suggestedMessage ?? followUp.reason,
      status: mapFollowUpStatus(followUp.status),
      scheduled_for: followUp.scheduledAt.toISOString(),
      sent_at: followUp.sentAt?.toISOString() ?? null,
      created_at: followUp.createdAt.toISOString(),
      updated_at: followUp.updatedAt.toISOString(),
    };
  });
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversation_id") ?? undefined;

    return NextResponse.json(await mapFollowUps(conversationId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load follow-ups" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { conversation_id, message, scheduled_for } = body;

    if (!conversation_id || !message || !scheduled_for) {
      return NextResponse.json(
        { error: "Missing required fields: conversation_id, message, scheduled_for" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();
    const conversation = await prisma.conversation.findUnique({
      where: {
        id: conversation_id,
      },
      include: {
        customer: true,
        lead: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation || !conversation.lead) {
      return NextResponse.json({ error: "Conversation or lead not found" }, { status: 404 });
    }

    await scheduleFollowUp({
      leadId: conversation.lead.id,
      conversationId: conversation.id,
      type: FollowUpType.NO_RESPONSE,
      reason: "dashboard_manual_follow_up",
      suggestedMessage: message.trim(),
      scheduledAt: scheduled_for,
    });

    const followUps = await mapFollowUps(conversation.id);
    return NextResponse.json(followUps.at(-1) ?? null);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
