import { NextResponse } from "next/server";
import {
  cancelFollowUpById,
  hasCustomerReplyAfterFollowUp,
  pickAutoFollowUpTemplate,
  scheduleAutoFollowUp,
  getLatestDraftOrder,
} from "@/lib/followups";
import { supabase } from "@/lib/supabase";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import type { Conversation } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = {
  info: (message: string, details?: unknown) =>
    console.log(`[WH-INFO] ${message}`, details ?? ""),
  warn: (message: string, details?: unknown) =>
    console.warn(`[WH-WARN] ${message}`, details ?? ""),
  error: (message: string, details?: unknown) =>
    console.error(`[WH-ERROR] ${message}`, details ?? ""),
};

async function processPendingFollowUps(request: Request) {
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    log.error("CRON_SECRET missing; refusing cron execution");
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${cronSecret}`;

  if (authHeader !== expected) {
    log.warn("Unauthorized cron invocation blocked");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date().toISOString();

    const { data: pending, error: pendingError } = await supabase
      .from("follow_ups")
      .select("*")
      .eq("status", "pending")
      .lte("scheduled_for", now)
      .order("scheduled_for", { ascending: true })
      .limit(20);

    if (pendingError) {
      log.error("Pending follow-up lookup failed", {
        error: pendingError.message,
      });
      return NextResponse.json({ error: pendingError.message }, { status: 500 });
    }

    log.info("Cron follow-up batch loaded", {
      pendingCount: pending?.length ?? 0,
    });

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const item of pending || []) {
      try {
        const { data: conversation, error: conversationError } = await supabase
          .from("conversations")
          .select("id, mode, sales_state")
          .eq("id", item.conversation_id)
          .maybeSingle();

        if (conversationError) {
          log.error("Conversation lookup failed before follow-up send", {
            followUpId: item.id,
            conversationId: item.conversation_id,
            error: conversationError.message,
          });
          results.push({
            id: item.id,
            status: "conversation_lookup_failed",
            error: conversationError.message,
          });
          continue;
        }

        if (!conversation) {
          await cancelFollowUpById(item.id, "conversation_missing");
          results.push({
            id: item.id,
            status: "cancelled_conversation_missing",
          });
          continue;
        }

        if (conversation.mode === "human" || conversation.sales_state === "human_handoff") {
          await cancelFollowUpById(item.id, "conversation_in_human_mode");
          results.push({
            id: item.id,
            status: "cancelled_human_mode",
          });
          continue;
        }

        const customerReplied = await hasCustomerReplyAfterFollowUp(
          item.conversation_id,
          item.created_at
        );

        if (customerReplied) {
          await cancelFollowUpById(item.id, "customer_replied_after_schedule");
          results.push({
            id: item.id,
            status: "cancelled_stale",
          });
          continue;
        }

        const sentAt = new Date().toISOString();

        // Phase 2 Fix: Atomically claim the follow-up
        const { data: claimed, error: claimError } = await supabase
          .from("follow_ups")
          .update({
            status: "sent",
            sent_at: sentAt,
            updated_at: sentAt,
          })
          .eq("id", item.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (claimError || !claimed) {
          log.warn("Follow-up already claimed or processed", { followUpId: item.id });
          results.push({ id: item.id, status: "already_claimed_or_processed" });
          continue;
        }

        let sendResult;
        try {
          sendResult = await sendWhatsAppMessage(item.phone, item.message);
        } catch (error) {
          // Revert claim on network failure so it can be retried
          await supabase
            .from("follow_ups")
            .update({ status: "pending", sent_at: null })
            .eq("id", item.id);
          throw error;
        }

        const outboundId = sendResult?.messages?.[0]?.id || null;
        const postSendErrors: string[] = [];

        const { error: messageInsertError } = await supabase.from("messages").insert({
          conversation_id: item.conversation_id,
          role: "assistant",
          content: item.message,
          whatsapp_msg_id: outboundId,
        });

        if (messageInsertError) {
          log.error("Assistant follow-up message store failed after send", {
            followUpId: item.id,
            error: messageInsertError.message,
          });
          postSendErrors.push(`message_store_failed: ${messageInsertError.message}`);
        }

        try {
          // Use atomic RPC for state progression
          const { data, error: incErr } = await supabase
            .rpc("increment_follow_up_count", { conv_id: item.conversation_id })
            .single();

          const updatedConvo = data as Conversation | null;

          if (incErr) {
            log.error("Failed to increment follow-up count", incErr);
            postSendErrors.push(`inc_failed: ${incErr.message}`);
          } else if (updatedConvo) {
            const draftOrder = await getLatestDraftOrder(item.conversation_id);
            const nextFollowUp = pickAutoFollowUpTemplate({
              conversation: updatedConvo,
              draftOrder,
            });

            if (nextFollowUp.message && nextFollowUp.delayHours) {
              await scheduleAutoFollowUp({
                conversationId: item.conversation_id,
                phone: item.phone,
                message: nextFollowUp.message,
                delayHours: nextFollowUp.delayHours,
                reason: nextFollowUp.reason,
              });
            }
          }
        } catch (error) {
          log.error("Recovery scheduling failed", error);
          postSendErrors.push(`schedule_failed: ${error instanceof Error ? error.message : String(error)}`);
        }

        results.push({
          id: item.id,
          status: postSendErrors.length > 0 ? "sent_with_post_send_errors" : "sent",
          error: postSendErrors.length > 0 ? postSendErrors.join("; ") : undefined,
        });
      } catch (error) {
        log.error("Follow-up send failed", {
          followUpId: item.id,
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          id: item.id,
          status: "send_failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      processed: results.length,
      results,
    });
  } catch (error) {
    log.error("Cron follow-up route failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  return processPendingFollowUps(request);
}

export async function POST(request: Request) {
  return processPendingFollowUps(request);
}
