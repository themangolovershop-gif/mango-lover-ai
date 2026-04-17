import "server-only";

import { supabase } from "@/lib/supabase";
import { sizeLabel } from "@/lib/sales";
import type { Conversation, Order } from "@/lib/types";

type FollowUpTemplateResult = {
  message: string | null;
  reason: string | null;
  delayHours: number | null;
};

const followUpLog = {
  info: (message: string, details?: unknown) =>
    console.log(`[WH-INFO] ${message}`, details ?? ""),
  warn: (message: string, details?: unknown) =>
    console.warn(`[WH-WARN] ${message}`, details ?? ""),
  error: (message: string, details?: unknown) =>
    console.error(`[WH-ERROR] ${message}`, details ?? ""),
};

export function pickAutoFollowUpTemplate(args: {
  conversation: Conversation;
  draftOrder: Order | null;
}): FollowUpTemplateResult {
  const { conversation, draftOrder } = args;
  const count = conversation.follow_up_count || 0;

  // We only send up to 3 automated follow-ups per state change
  if (count >= 3) {
    return { message: null, reason: null, delayHours: null };
  }

  if (conversation.sales_state === "browsing") {
    return {
      message:
        "Hey, The Corporate Mango here. 🥭\n\nWould you like me to recommend the best box for home use or gifting?",
      reason: "browsing_reminder",
      delayHours: count === 0 ? 1 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_quantity") {
    return {
      message: count === 0 
        ? "Good choice. How many boxes should I keep ready for you? 📦"
        : "Still thinking about the quantity? Just let me know and I'll reserve your boxes.",
      reason: "quantity_reminder",
      delayHours: count === 0 ? 2 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_name") {
    return {
      message:
        count === 0
          ? "Almost done with your order! Just your name please so I can keep the mangoes ready for you? 🥭"
          : "I'm still holding your mangoes. May I know your name to finalize the draft?",
      reason: "name_reminder",
      delayHours: count === 0 ? 3 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_address") {
    const name = draftOrder?.customer_name || "there";
    const size = draftOrder?.product_size ? sizeLabel(draftOrder.product_size) : "premium";
    const qty = draftOrder?.quantity ? `${draftOrder.quantity} boxes of ` : "";

    return {
      message:
        count === 0
          ? `Hi ${name}, I've got your order for ${qty}${size} mangoes ready. 🥭\n\nWhere should we deliver them?`
          : `Hey ${name}, wouldn't want you to miss out on these ${size} mangoes! Just send your address and we are good to go. 🚚`,
      reason: "address_reminder",
      delayHours: count === 0 ? 4 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_date") {
    const name = draftOrder?.customer_name || "there";
    return {
      message:
        count === 0
          ? `Got the address, ${name}! 👍\n\nWhen would you like us to deliver your mangoes?`
          : `Hi ${name}, just checking if you had a delivery date in mind for your mango boxes?`,
      reason: "date_reminder",
      delayHours: count === 0 ? 4 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_confirmation" && draftOrder) {
    const address = draftOrder.delivery_address || "your place";
    return {
      message:
        count === 0
          ? `Ready to ship to ${address}! 🚚\n\nJust reply CONFIRM to lock in your order.`
          : `Holding your shipment to ${address}. Please reply CONFIRM to finalize, or let me know if you need to change anything!`,
      reason: "confirmation_reminder",
      delayHours: count === 0 ? 2 : 12,
    };
  }

  if (conversation.sales_state === "confirmed") {
    return {
      message:
        "The Corporate Mango checking in.\n\nMost mango lovers reorder within a week during the season.\n\nWould you like me to reserve your next batch?",
      reason: "repeat_buyer_reactivation",
      delayHours: 120,
    };
  }

  if (conversation.lead_tag === "corporate_lead") {
    return {
      message:
        "Just following up on your corporate mango gifting requirement.\n\nWe can help with premium boxes for teams, clients, and events.\n\nWould you like me to prepare options?",
      reason: "corporate_follow_up",
      delayHours: 24,
    };
  }

  return {
    message: null,
    reason: null,
    delayHours: null,
  };
}

export async function getLatestDraftOrder(conversationId: string) {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("status", ["draft", "awaiting_confirmation", "confirmed"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data as Order | null;
}

export async function scheduleAutoFollowUp(args: {
  conversationId: string;
  phone: string;
  message: string;
  delayHours: number;
  reason?: string | null;
}) {
  const { conversationId, phone, message, delayHours, reason } = args;

  const scheduledFor = new Date();
  scheduledFor.setHours(scheduledFor.getHours() + delayHours);

  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      conversation_id: conversationId,
      phone,
      message,
      scheduled_for: scheduledFor.toISOString(),
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    followUpLog.error("Follow-up scheduling failed", {
      conversationId,
      reason,
      error: error.message,
    });
    throw error;
  }

  followUpLog.info("Follow-up scheduled", {
    conversationId,
    followUpId: data.id,
    reason: reason || null,
    scheduledFor: data.scheduled_for,
  });

  return data;
}

export async function hasPendingFollowUp(conversationId: string) {
  const { data, error } = await supabase
    .from("follow_ups")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

export async function cancelPendingFollowUps(conversationId: string, reason: string) {
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("follow_ups")
    .update({
      status: "cancelled",
      updated_at: updatedAt,
    })
    .eq("conversation_id", conversationId)
    .eq("status", "pending")
    .select("id");

  if (error) {
    followUpLog.error("Pending follow-up cancellation failed", {
      conversationId,
      reason,
      error: error.message,
    });
    throw error;
  }

  const cancelledCount = data?.length ?? 0;

  if (cancelledCount > 0) {
    followUpLog.info("Cancelled pending follow-ups", {
      conversationId,
      cancelledCount,
      reason,
    });
  }

  return cancelledCount;
}

export async function cancelFollowUpById(followUpId: string, reason: string) {
  const updatedAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("follow_ups")
    .update({
      status: "cancelled",
      updated_at: updatedAt,
    })
    .eq("id", followUpId)
    .eq("status", "pending")
    .select("id, conversation_id")
    .maybeSingle();

  if (error) {
    followUpLog.error("Single follow-up cancellation failed", {
      followUpId,
      reason,
      error: error.message,
    });
    throw error;
  }

  if (data) {
    followUpLog.info("Cancelled stale follow-up", {
      followUpId,
      conversationId: data.conversation_id,
      reason,
    });
  }

  return !!data;
}

export async function hasCustomerReplyAfterFollowUp(
  conversationId: string,
  followUpCreatedAt: string
) {
  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .gt("created_at", followUpCreatedAt)
    .limit(1)
    .maybeSingle();

  if (error) {
    followUpLog.error("Customer reply lookup for follow-up failed", {
      conversationId,
      followUpCreatedAt,
      error: error.message,
    });
    throw error;
  }

  return !!data;
}

export async function incrementFollowUpCount(conversationId: string) {
  const { data: convo, error: readError } = await supabase
    .from("conversations")
    .select("follow_up_count")
    .eq("id", conversationId)
    .single();

  if (readError) {
    followUpLog.error("Follow-up count read failed", {
      conversationId,
      error: readError.message,
    });
    throw readError;
  }

  const nextCount = (convo?.follow_up_count || 0) + 1;
  const updatedAt = new Date().toISOString();

  const { error: updateError } = await supabase
    .from("conversations")
    .update({
      follow_up_count: nextCount,
      last_follow_up_sent_at: updatedAt,
      updated_at: updatedAt,
    })
    .eq("id", conversationId);

  if (updateError) {
    followUpLog.error("Follow-up count update failed", {
      conversationId,
      error: updateError.message,
    });
    throw updateError;
  }
}
