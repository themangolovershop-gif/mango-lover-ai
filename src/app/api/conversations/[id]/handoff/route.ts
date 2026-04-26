import { ConversationStatus, LeadStage } from "@prisma/client";
import { NextResponse } from "next/server";

import { cancelPendingFollowUpsForConversation } from "@/backend/modules/followups/follow-up.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prisma = getPrismaClient();

    await prisma.conversation.update({
      where: {
        id,
      },
      data: {
        status: ConversationStatus.PENDING_HUMAN,
        currentStage: LeadStage.HUMAN_HANDOFF,
        buyerType: "human_required",
      },
    });

    try {
      await cancelPendingFollowUpsForConversation(id, "human_handoff");
    } catch (error) {
      console.warn("[WH-WARN] Pending follow-up cancellation after handoff failed", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to hand off conversation" },
      { status: 500 }
    );
  }
}
