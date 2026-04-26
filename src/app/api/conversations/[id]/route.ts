import { ConversationStatus, LeadStage } from "@prisma/client";
import { NextRequest } from "next/server";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  if (body.mode && !["agent", "human"].includes(body.mode)) {
    return Response.json({ error: "Invalid mode" }, { status: 400 });
  }

  const prisma = getPrismaClient();

  try {
    const data =
      body.mode === "human"
        ? {
            status: ConversationStatus.PENDING_HUMAN,
            currentStage: LeadStage.HUMAN_HANDOFF,
            buyerType: "human_required",
          }
        : {
            status: ConversationStatus.OPEN,
          };

    const conversation = await prisma.conversation.update({
      where: {
        id,
      },
      data,
      include: {
        customer: true,
      },
    });

    return Response.json({
      id: conversation.id,
      mode:
        conversation.status === ConversationStatus.PENDING_HUMAN ? "human" : "agent",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update conversation" },
      { status: 500 }
    );
  }
}
