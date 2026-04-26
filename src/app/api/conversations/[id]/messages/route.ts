import { NextRequest } from "next/server";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prisma = getPrismaClient();
    const messages = await prisma.message.findMany({
      where: {
        conversationId: id,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return Response.json(
      messages.map((message) => ({
        id: message.id,
        conversation_id: message.conversationId,
        role: message.sentBy === "CUSTOMER" ? "user" : "assistant",
        content: message.rawText,
        whatsapp_msg_id: message.providerMessageId,
        created_at: message.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load messages" },
      { status: 500 }
    );
  }
}
