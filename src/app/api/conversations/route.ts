import { ConversationStatus, LeadStage } from "@prisma/client";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function mapLeadStageToSalesState(stage: LeadStage) {
  switch (stage) {
    case LeadStage.NEW:
      return "new";
    case LeadStage.BROWSING:
      return "browsing";
    case LeadStage.AWAITING_QUANTITY:
      return "awaiting_quantity";
    case LeadStage.AWAITING_ADDRESS:
      return "awaiting_address";
    case LeadStage.AWAITING_DATE:
      return "awaiting_date";
    case LeadStage.AWAITING_CONFIRMATION:
      return "awaiting_confirmation";
    case LeadStage.CONFIRMED:
      return "confirmed";
    case LeadStage.HUMAN_HANDOFF:
      return "human_handoff";
    case LeadStage.LOST:
      return "lost";
    default:
      return "new";
  }
}

export async function GET() {
  try {
    const prisma = getPrismaClient();
    
    // Use standard Prisma queries to leverage the schema.prisma source of truth
    const conversations = await prisma.conversation.findMany({
      include: {
        customer: true,
        messages: {
          orderBy: {
            createdAt: 'asc'
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });

    return Response.json(
      conversations.map((c) => {
        const nestedMessages = c.messages.map((m) => ({
          id: m.id,
          role: m.sentBy === "CUSTOMER" ? "user" : "assistant",
          content: m.rawText,
          created_at: m.createdAt.toISOString(),
        }));

        return {
          id: c.id,
          name: c.customer.name,
          phone: c.customer.phone,
          mode: c.status === ConversationStatus.PENDING_HUMAN ? "human" : "agent",
          sales_state: mapLeadStageToSalesState(c.currentStage),
          lead_tag: c.buyerType,
          updated_at: c.updatedAt.toISOString(),
          last_message: nestedMessages.at(-1)?.content ?? null,
          messages: nestedMessages,
        };
      })
    );
  } catch (error) {
    console.error("[WH-ERROR] Conversations fetch failed", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load conversations.",
      },
      { status: 500 }
    );
  }
}
