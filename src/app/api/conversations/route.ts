import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { data: conversations, error } = await supabase
      .from("conversations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[WH-ERROR] Conversations fetch failed", error);
      return Response.json({ error: error.message }, { status: 500 });
    }

    const withLastMessage = await Promise.all(
      (conversations || []).map(async (conversation) => {
        const { data: messages, error: messageError } = await supabase
          .from("messages")
          .select("content")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(1);

        if (messageError) {
          console.error("[WH-ERROR] Last message fetch failed", {
            conversationId: conversation.id,
            error: messageError,
          });
        }

        return {
          ...conversation,
          last_message: messages?.[0]?.content || null,
        };
      })
    );

    return Response.json(withLastMessage);
  } catch (error) {
    console.error("[WH-ERROR] Conversations route failed", error);
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
