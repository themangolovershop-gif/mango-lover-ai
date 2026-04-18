import "server-only";

import { supabase } from "@/lib/supabase";
import { sizeLabel } from "@/lib/sales";
import { DEFAULT_SALES_SETTINGS } from "@/lib/sales-settings";
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

  if (count >= DEFAULT_SALES_SETTINGS.followUp.maxAttempts) {
    return { message: null, reason: null, delayHours: null };
  }

  if (conversation.sales_state === "browsing") {
    return {
      message:
        "Checking in from The Mango Lover Shop.\n\nIf you'd like, I can recommend the best box for home use or gifting.",
      reason: "browsing_reminder",
      delayHours: count === 0 ? 4 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_quantity") {
    return {
      message:
        count === 0
          ? "Your preferred box is ready to note.\n\nJust send the quantity you want, and I will prepare the draft."
          : "Following up on the quantity for your mango order.\n\nOnce you send it, I can move this ahead.",
      reason: "quantity_reminder",
      delayHours: count === 0 ? 4 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_name") {
    return {
      message:
        count === 0
          ? "Your order draft is almost ready.\n\nMay I have the customer name for it?"
          : "Following up on the order name so I can keep the draft complete.",
      reason: "name_reminder",
      delayHours: count === 0 ? 6 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_address") {
    const name = draftOrder?.customer_name || "there";
    const size = draftOrder?.product_size ? sizeLabel(draftOrder.product_size) : "premium";
    const qty = draftOrder?.quantity ? `${draftOrder.quantity} box${draftOrder.quantity > 1 ? "es" : ""}` : "the selected";

    return {
      message:
        count === 0
          ? `Hi ${name}, I have ${qty} of ${size} noted.\n\nPlease share the delivery address so I can complete the draft.`
          : `Following up on the delivery address for your ${size} mango order.`,
      reason: "address_reminder",
      delayHours: count === 0 ? 6 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_date") {
    const name = draftOrder?.customer_name || "there";
    return {
      message:
        count === 0
          ? `Hi ${name}, I have the address ready.\n\nPlease share the delivery date you want for this order.`
          : `Following up on the delivery date so I can lock the order correctly.`,
      reason: "date_reminder",
      delayHours: count === 0 ? 6 : 24,
    };
  }

  if (conversation.sales_state === "awaiting_confirmation" && draftOrder) {
    const address = draftOrder.delivery_address || "your address";
    return {
      message:
        count === 0
          ? `Your order draft for ${address} is ready.\n\nPlease reply CONFIRM if everything looks right.`
          : `Following up on the order confirmation for ${address}.`,
      reason: "confirmation_reminder",
      delayHours: count === 0 ? 4 : 18,
    };
  }

  if (conversation.sales_state === "confirmed") {
    return {
      message:
        "A quick note from The Mango Lover Shop.\n\nIf you'd like another batch during the season, I can help you reserve it early.",
      reason: "repeat_buyer_reactivation",
      delayHours: 120,
    };
  }

  if (conversation.lead_tag === "corporate_lead") {
    return {
      message:
        "Following up on your premium gifting requirement.\n\nIf you share the quantity and delivery city, our team can guide you correctly.",
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
