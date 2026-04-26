import { Prisma } from "@prisma/client";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ConversationRow = {
  id: string;
  name: string | null;
  phone: string;
  mode: "agent" | "human";
  sales_state: string;
  lead_tag: "hot" | "warm" | "cold" | "corporate_lead" | "gift_lead" | null;
  updated_at: Date;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date;
};

export async function GET() {
  try {
    const prisma = getPrismaClient();
    const [conversations, messages] = await Promise.all([
      prisma.$queryRaw<ConversationRow[]>(Prisma.sql`
        select
          id::text,
          name,
          phone,
          mode,
          sales_state,
          lead_tag,
          updated_at
        from public.conversations
        order by updated_at desc
      `),
      prisma.$queryRaw<MessageRow[]>(Prisma.sql`
        select
          id::text,
          conversation_id::text,
          role,
          content,
          created_at
        from public.messages
        order by created_at asc
      `),
    ]);

    const messagesByConversationId = messages.reduce<Record<string, MessageRow[]>>(
      (groupedMessages, message) => {
        const existingMessages = groupedMessages[message.conversation_id] ?? [];
        existingMessages.push(message);
        groupedMessages[message.conversation_id] = existingMessages;
        return groupedMessages;
      },
      {}
    );

    return Response.json(
      conversations.map((conversation) => {
        const nestedMessages = (messagesByConversationId[conversation.id] ?? []).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          created_at: message.created_at.toISOString(),
        }));

        return {
          id: conversation.id,
          name: conversation.name,
          phone: conversation.phone,
          mode: conversation.mode,
          sales_state: conversation.sales_state,
          lead_tag: conversation.lead_tag,
          updated_at: conversation.updated_at.toISOString(),
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
