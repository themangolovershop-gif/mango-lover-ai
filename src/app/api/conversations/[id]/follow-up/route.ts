import { FollowUpType } from "@prisma/client";
import { NextResponse } from "next/server";

import { scheduleFollowUp } from "@/backend/modules/followups/follow-up.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const message = body?.message?.trim();
    const scheduledFor = body?.scheduled_for;

    if (!message || !scheduledFor) {
      return NextResponse.json(
        { error: "message and scheduled_for are required" },
        { status: 400 }
      );
    }

    const prisma = getPrismaClient();
    const conversation = await prisma.conversation.findUnique({
      where: {
        id,
      },
      include: {
        lead: {
          select: {
            id: true,
          },
        },
      },
    });

    if (!conversation || !conversation.lead) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const data = await scheduleFollowUp({
      leadId: conversation.lead.id,
      conversationId: conversation.id,
      type: FollowUpType.NO_RESPONSE,
      reason: "dashboard_manual_follow_up",
      suggestedMessage: message,
      scheduledAt: scheduledFor,
    });

    return NextResponse.json({
      id: data.id,
      conversation_id: data.conversationId,
      message: data.suggestedMessage ?? data.reason,
      status: data.status.toLowerCase(),
      scheduled_for: data.scheduledAt.toISOString(),
      sent_at: data.sentAt?.toISOString() ?? null,
      created_at: data.createdAt.toISOString(),
      updated_at: data.updatedAt.toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to schedule follow-up" },
      { status: 500 }
    );
  }
}
