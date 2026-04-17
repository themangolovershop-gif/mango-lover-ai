import { NextRequest } from "next/server";
import crypto from "crypto";
import { getAIResponse } from "@/lib/ai";
import {
  cancelPendingFollowUps,
  getLatestDraftOrder,
  hasPendingFollowUp,
  pickAutoFollowUpTemplate,
  scheduleAutoFollowUp,
} from "@/lib/followups";
import {
  buildSalesReply,
  getCheckoutFallback,
  getDeterministicTransition,
  getDraftOrder,
  isLockedCheckoutState,
  normalizeSalesStateValue,
  parseSalesInput,
  persistDraftOrderPatch,
  updateConversationSalesFields,
} from "@/lib/sales";
import { supabase } from "@/lib/supabase";
import type { Conversation, InteractiveButton } from "@/lib/types";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WebhookTextMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: {
    body?: string;
  };
  interactive?: {
    button_reply?: {
      title?: string;
    };
  };
};

type WebhookContact = {
  profile?: {
    name?: string;
  };
};

type WhatsAppWebhookBody = {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WebhookTextMessage[];
        contacts?: WebhookContact[];
      };
    }>;
  }>;
};

type WebhookResult =
  | {
      status:
        | "replied"
        | "stored_for_human"
        | "duplicate"
        | "ignored_malformed_text"
        | "ignored_not_text";
      conversation_id?: string;
      outbound_meta_message_id?: string;
      whatsapp_msg_id?: string;
    }
  | {
      status: "failed";
      whatsapp_msg_id?: string;
      error: string;
    };

const log = {
  info: (message: string, details?: unknown) =>
    console.log(`[WH-INFO] ${message}`, details ?? ""),
  debug: (message: string, details?: unknown) =>
    console.log(`[WH-DEBUG] ${message}`, details ?? ""),
  warn: (message: string, details?: unknown) =>
    console.warn(`[WH-WARN] ${message}`, details ?? ""),
  error: (message: string, details?: unknown) =>
    console.error(`[WH-ERROR] ${message}`, details ?? ""),
};

function buildSafeFallbackReply() {
  return [
    "I can help with mango orders.",
    "",
    "Reply PRICE to see the box options, or send Medium, Large, or Jumbo to place an order.",
  ].join("\n");
}

function verifySignature(payload: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  
  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      log.warn("⚠️ WHATSAPP_APP_SECRET is missing. Allowing unsigned request in LOCAL DEV mode.");
      return true;
    }
    log.error("❌ CRITICAL: WHATSAPP_APP_SECRET is not configured in environment. All production webhooks will be rejected.");
    return false;
  }

  if (!signature) {
    log.warn("⚠️ Webhook received without signature header (x-hub-signature-256).");
    return false;
  }

  try {
    const [algo, hash] = signature.split("=");
    if (algo !== "sha256" || !hash) {
      log.error("Invalid signature format", { signature });
      return false;
    }

    const hmac = crypto.createHmac("sha256", secret);
    const expectedHash = hmac.update(payload).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(expectedHash));
  } catch (err) {
    log.error("Signature verification error", err);
    return false;
  }
}

function getInboundMessageText(message: WebhookTextMessage): string | null {
  const textBody = message.text?.body?.trim();
  if (textBody) return textBody;

  const buttonReplyTitle = message.interactive?.button_reply?.title?.trim();
  if (buttonReplyTitle) return buttonReplyTitle;

  return null;
}

async function touchConversation(conversationId: string) {
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  if (error) {
    log.warn("Conversation timestamp update failed", {
      conversationId,
      error: error.message,
    });
  }
}

async function logWebhook(params: {
  whatsapp_msg_id?: string;
  phone?: string;
  status: string;
  payload?: unknown;
  error?: string;
  duration_ms?: number;
}) {
  try {
    const { error } = await supabase.from("webhook_logs").insert({
      whatsapp_msg_id: params.whatsapp_msg_id || null,
      phone: params.phone || null,
      status: params.status,
      payload: params.payload || null,
      error: params.error || null,
      duration_ms: params.duration_ms || null,
    });

    if (error) {
      log.error("Failed to persist webhook log to DB", error);
    }
  } catch (err) {
    log.error("Internal error during webhook logging", err);
  }
}

async function getOrCreateConversation(phone: string, name: string | null) {
  const { data: existingConversation, error: fetchConversationError } = await supabase
    .from("conversations")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (fetchConversationError) {
    throw new Error(`Conversation fetch failed: ${fetchConversationError.message}`);
  }

  if (existingConversation) {
    return { conversation: existingConversation, created: false };
  }

  const { data: createdConversation, error: createConversationError } = await supabase
    .from("conversations")
    .insert({
      phone,
      name,
      sales_state: "new",
    })
    .select()
    .single();

  if (createConversationError) {
    throw new Error(`Conversation create failed: ${createConversationError.message}`);
  }

  log.info("Conversation created", {
    conversationId: createdConversation.id,
    phone,
  });

  return { conversation: createdConversation, created: true };
}

async function handleInboundTextMessage(
  message: WebhookTextMessage,
  name: string | null
): Promise<WebhookResult> {
  const startedAt = Date.now();
  const phone = message.from;
  const text = getInboundMessageText(message);
  const whatsappMsgId = message.id;

  if (!phone || !text || !whatsappMsgId) {
    log.warn("Ignoring malformed text message payload", {
      hasPhone: !!phone,
      hasText: !!text,
      hasMessageId: !!whatsappMsgId,
    });
    return {
      status: "ignored_malformed_text",
      whatsapp_msg_id: whatsappMsgId,
    };
  }

  log.info("Inbound WhatsApp message received", {
    phone,
    whatsappMsgId,
    preview: text.slice(0, 80),
  });
  log.debug("incoming message", {
    phone,
    whatsappMsgId,
    preview: text.slice(0, 80),
  });

  const MAX_RETRIES = 3;
  let attempt = 0;
  let inboundStored = false;

  while (attempt < MAX_RETRIES) {
    try {
      const { conversation } = await getOrCreateConversation(phone, name);

      if (!inboundStored) {
        const { error: insertInboundError } = await supabase.from("messages").insert({
          conversation_id: conversation.id,
          role: "user",
          content: text,
          whatsapp_msg_id: whatsappMsgId,
        });

        if (insertInboundError) {
          if (insertInboundError.code === "23505") {
            log.info("Duplicate inbound WhatsApp message ignored", {
              whatsappMsgId,
              phone,
            });
            return {
              status: "duplicate",
              conversation_id: conversation.id,
              whatsapp_msg_id: whatsappMsgId,
            };
          }
          throw new Error(`Inbound message insert failed: ${insertInboundError.message}`);
        }

        inboundStored = true;

        log.info("Inbound message stored", {
          conversationId: conversation.id,
          whatsappMsgId,
        });

        await cancelPendingFollowUps(conversation.id, "customer_replied");
      } else {
        log.debug("Retrying webhook flow after optimistic lock conflict", {
          conversationId: conversation.id,
          whatsappMsgId,
          attempt: attempt + 1,
        });
      }

      if (conversation.mode === "human") {
        await touchConversation(conversation.id);
        log.info("Conversation in human mode, skipping automation", {
          conversationId: conversation.id,
        });
        return {
          status: "stored_for_human",
          conversation_id: conversation.id,
          whatsapp_msg_id: whatsappMsgId,
        };
      }

      const stateBefore = normalizeSalesStateValue(
        (conversation as Conversation & { sales_state?: string }).sales_state
      );
      log.debug("state before", {
        conversationId: conversation.id,
        stateBefore,
      });
      const typedConversation = {
        ...(conversation as Conversation),
        sales_state: stateBefore,
      };
      
      const parsed = parseSalesInput(text);
      const draftOrderBefore = await getDraftOrder(typedConversation.id);

      const transition = getDeterministicTransition({
        conversation: typedConversation,
        parsed,
        order: draftOrderBefore,
        rawMessage: text,
      });
      log.debug("next state", {
        conversationId: typedConversation.id,
        stateBefore,
        nextState: transition.nextState,
      });

      const draftOrderAfter = await persistDraftOrderPatch({
        conversation: typedConversation,
        existingOrder: draftOrderBefore,
        orderPatch: transition.orderPatch,
      });

      const salesState = transition.nextState;
      const leadTag = transition.leadTag;
      const resetFollowUpCount = stateBefore !== salesState;

      const conversationAfter: Conversation = {
        ...typedConversation,
        sales_state: salesState,
        lead_tag: leadTag,
        last_customer_intent: transition.lastCustomerIntent,
        follow_up_count: resetFollowUpCount ? 0 : typedConversation.follow_up_count,
        name: (name && conversation.name !== name) ? name : conversation.name,
        updated_at: new Date().toISOString(),
      };

      const deterministicReply = buildSalesReply(
        conversationAfter,
        parsed,
        draftOrderAfter,
        text
      );
      log.debug("deterministicHit", {
        conversationId: typedConversation.id,
        deterministicHit: deterministicReply !== null,
      });
      
      const checkoutLocked = isLockedCheckoutState(stateBefore) || isLockedCheckoutState(salesState);
      log.debug("AI blocked", {
        conversationId: typedConversation.id,
        aiBlocked: deterministicReply === null && checkoutLocked,
        checkoutLocked,
      });
      let replyText = "";
      let replyButtons: InteractiveButton[] | undefined = undefined;

      if (deterministicReply !== null) {
        if (typeof deterministicReply === "object") {
          replyText = deterministicReply.text;
          replyButtons = deterministicReply.buttons;
        } else {
          replyText = deterministicReply;
        }
      } else {
        if (checkoutLocked) {
          replyText = getCheckoutFallback(salesState);
        } else {
          const { data: history, error: historyError } = await supabase
            .from("messages")
            .select("role, content")
            .eq("conversation_id", typedConversation.id)
            .order("created_at", { ascending: true })
            .limit(20);

          if (historyError) throw new Error(`History fetch failed: ${historyError.message}`);

          // AI Fallback blocked during checkout
          try {
            replyText = await getAIResponse((history || []).map((item) => ({
              role: item.role as "user" | "assistant",
              content: item.content,
            })));
          } catch {
            replyText = buildSafeFallbackReply();
          }
        }
      }

      if (!replyText) replyText = "Please tell me how I can help you today.";
      log.debug("reply preview", {
        conversationId: typedConversation.id,
        preview: replyText.slice(0, 120),
        hasButtons: !!replyButtons?.length,
        buttonCount: replyButtons?.length ?? 0,
      });

      await updateConversationSalesFields({
        conversationId: typedConversation.id,
        salesState,
        leadTag,
        lastCustomerIntent: transition.lastCustomerIntent,
        resetFollowUpCount,
        expectedUpdatedAt: conversation.updated_at,
        name: (name && conversation.name !== name) ? name : undefined,
      });

      const sendResult = await sendWhatsAppMessage(phone, replyText, replyButtons);
      const outboundMsgId = sendResult?.messages?.[0]?.id || null;

      if (!outboundMsgId) throw new Error("Meta send succeeded without an outbound message id.");

      const { error: insertAssistantError } = await supabase.from("messages").insert({
        conversation_id: typedConversation.id,
        role: "assistant",
        content: replyText,
        whatsapp_msg_id: outboundMsgId,
      });

      if (insertAssistantError) {
        throw new Error(`Assistant message insert failed: ${insertAssistantError.message}`);
      }

      const latestOrder = await getLatestDraftOrder(typedConversation.id);
      const followUpChoice = pickAutoFollowUpTemplate({
        conversation: conversationAfter,
        draftOrder: latestOrder,
      });
      const alreadyPending = await hasPendingFollowUp(typedConversation.id);

      if (followUpChoice.message && followUpChoice.delayHours && !alreadyPending) {
        await scheduleAutoFollowUp({
          conversationId: typedConversation.id,
          phone,
          message: followUpChoice.message,
          delayHours: followUpChoice.delayHours,
          reason: followUpChoice.reason,
        });
      }

      log.info("Webhook flow completed", {
        conversationId: typedConversation.id,
        outboundMsgId,
        durationMs: Date.now() - startedAt,
      });

      const result: WebhookResult = {
        status: "replied",
        conversation_id: typedConversation.id,
        outbound_meta_message_id: outboundMsgId,
        whatsapp_msg_id: whatsappMsgId,
      };

      await logWebhook({
        whatsapp_msg_id: whatsappMsgId,
        phone,
        status: result.status,
        duration_ms: Date.now() - startedAt,
      });

      return result;
    } catch (error) {
      if (error instanceof Error && error.message === "VERSION_CONFLICT") {
        attempt++;
        log.warn("Version conflict detected, retrying optimization loop", { attempt, phone });
        await new Promise(resolve => setTimeout(resolve, 150 * attempt));
        continue;
      }

      log.error("Critical webhook failure", {
        whatsappMsgId,
        error: error instanceof Error ? error.message : String(error),
      });
      
      const errorStatus = "failed";
      await logWebhook({
        whatsapp_msg_id: whatsappMsgId,
        phone,
        status: errorStatus,
        error: error instanceof Error ? error.message : String(error),
        duration_ms: Date.now() - startedAt,
      });

      return {
        status: errorStatus,
        whatsapp_msg_id: whatsappMsgId,
        error: error instanceof Error ? error.message : "Internal error",
      };
    }
  }

  await logWebhook({
    whatsapp_msg_id: whatsappMsgId,
    phone,
    status: "failed",
    error: "Max retries exceeded for version conflict",
    duration_ms: Date.now() - startedAt,
  });

  return {
    status: "failed",
    whatsapp_msg_id: whatsappMsgId,
    error: "Max retries exceeded for version conflict",
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN && challenge) {
    log.info("Webhook verified successfully");
    return new Response(challenge, { status: 200 });
  }

  log.warn("Webhook verification failed", { mode, hasToken: !!token });
  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-hub-signature-256");
  const rawBody = await request.text();

  if (!verifySignature(rawBody, signature)) {
    log.error("Webhook signature verification failed. Request rejected.");
    await logWebhook({
      status: "signature_failed",
      payload: rawBody.slice(0, 1000), // Log snippet
    });
    return new Response("Invalid signature", { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch (error) {
    log.error("Webhook JSON parse failed", error);
    await logWebhook({
      status: "json_parse_failed",
      payload: rawBody.slice(0, 1000),
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.object !== "whatsapp_business_account") {
    log.info("Ignoring non-WhatsApp webhook event", { object: body.object ?? null });
    return Response.json({ status: "ignored_non_whatsapp" });
  }

  const inboundMessages =
    body.entry?.flatMap((entry) =>
      (entry.changes || []).flatMap((change) => {
        const value = change.value;
        const name = value?.contacts?.[0]?.profile?.name || null;

        return (value?.messages || []).map((message) => ({
          message,
          name,
        }));
      })
    ) || [];

  if (inboundMessages.length === 0) {
    log.info("Ignoring webhook event without message payload");
    return Response.json({ status: "ignored_no_message" });
  }

  const results: WebhookResult[] = [];

  for (const { message, name } of inboundMessages) {
    const inboundText = getInboundMessageText(message);

    if (!inboundText) {
      log.info("Ignoring non-text message", {
        type: message.type ?? null,
        whatsappMsgId: message.id ?? null,
      });
      results.push({
        status: "ignored_not_text",
        whatsapp_msg_id: message.id,
      });
      continue;
    }

    results.push(await handleInboundTextMessage(message, name));
  }

  const failed = results.find((result) => result.status === "failed");

  if (failed && "error" in failed) {
    return Response.json(
      {
        status: "failed",
        results,
      },
      { status: 500 }
    );
  }

  if (results.length === 1) {
    return Response.json(results[0]);
  }

  return Response.json({
    status: "processed",
    results,
  });
}
