import { MessageSender } from "@prisma/client";

import { cancelPendingFollowUpsForConversation } from "@/backend/modules/followups/follow-up.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { sendOutboundWhatsAppMessage } from "@/backend/modules/whatsapp/outbound.service";

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

    if (!message) {
      return Response.json({ error: "Message is required" }, { status: 400 });
    }

    const prisma = getPrismaClient();
    const conversation = await prisma.conversation.findUnique({
      where: {
        id,
      },
      include: {
        customer: true,
      },
    });

    if (!conversation) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const outbound = await sendOutboundWhatsAppMessage({
      conversationId: id,
      body: message,
      sentBy: MessageSender.HUMAN,
      phone: conversation.customer.phone,
    });

    try {
      await cancelPendingFollowUpsForConversation(id, "manual_message_sent");
    } catch (error) {
      console.warn("[WH-WARN] Pending follow-up cancellation after manual send failed", error);
    }

    return Response.json({
      success: true,
      whatsapp_msg_id: outbound.providerMessageId,
    });
  } catch (error) {
    console.error("[WH-ERROR] Manual send route failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
