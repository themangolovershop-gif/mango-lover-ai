import { cancelPendingFollowUps } from "@/lib/followups";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

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

    const { data: conversation, error: convoError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (convoError || !conversation) {
      console.error("[WH-ERROR] Conversation lookup failed for manual send", convoError);
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }

    const sendResult = await sendWhatsAppMessage(conversation.phone, message);
    const whatsappMsgId = sendResult?.messages?.[0]?.id || null;

    if (!whatsappMsgId) {
      console.error("[WH-ERROR] Manual send missing Meta outbound id", sendResult);
      return Response.json({ error: "Meta message id missing" }, { status: 502 });
    }

    const { error: insertError } = await supabase.from("messages").insert({
      conversation_id: id,
      role: "assistant",
      content: message,
      whatsapp_msg_id: whatsappMsgId,
    });

    if (insertError) {
      console.error("[WH-ERROR] Manual assistant message insert failed", insertError);
      return Response.json({ error: insertError.message }, { status: 500 });
    }

    try {
      await cancelPendingFollowUps(id, "manual_message_sent");
    } catch (error) {
      console.warn("[WH-WARN] Pending follow-up cancellation after manual send failed", error);
    }

    const { error: updateError } = await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      console.error("[WH-ERROR] Manual send conversation timestamp update failed", updateError);
      return Response.json({ error: updateError.message }, { status: 500 });
    }

    return Response.json({ success: true, whatsapp_msg_id: whatsappMsgId });
  } catch (error) {
    console.error("[WH-ERROR] Manual send route failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
