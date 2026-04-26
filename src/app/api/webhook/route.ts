import { NextRequest } from "next/server";
import crypto from "crypto";
import { processSmartReply } from "@/lib/smart-reply/messageProcessor";
import { cancelPendingFollowUps } from "@/lib/followups";
import { supabase } from "@/lib/supabase";
import type { Conversation } from "@/lib/types";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { AGENT_VERSION } from "@/backend/shared/version";
import { extractEntities } from "@/backend/modules/ai/entity.service";
import { normalizeMessage } from "@/backend/shared/utils/normalization";
import { logger } from "@/backend/shared/lib/logger";

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
    .from("Conversation")
    .update({ updatedAt: new Date().toISOString() })
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
    // Ensure AGENT_VERSION is always part of the logged payload for observability
    const enhancedPayload = typeof params.payload === 'object' && params.payload !== null
      ? { ...params.payload, agent_version: AGENT_VERSION }
      : { raw: params.payload, agent_version: AGENT_VERSION };

    const { error } = await supabase.from("webhook_logs").insert({
      whatsapp_msg_id: params.whatsapp_msg_id || null,
      phone: params.phone || null,
      status: params.status,
      payload: enhancedPayload,
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

/**
 * Background worker to extract entities and update dashboard signals
 * without blocking the main reply flow.
 */
async function processBackgroundSignals(conversationId: string, text: string) {
  try {
    const normalizedText = normalizeMessage(text);
    const entities = extractEntities(normalizedText);
    
    // 1. Update Lead Tag if strong signals found
    const leadPatch: any = {};
    if (entities.gifting) leadPatch.lead_tag = "gift_lead";
    if (entities.urgency) leadPatch.lead_tag = "hot";
    
    if (Object.keys(leadPatch).length > 0) {
      await supabase.from("Conversation").update(leadPatch).eq("id", conversationId);
    }

    // 2. Update Draft Order if quantity or size found
    if (entities.quantityDozen || entities.size) {
      // Find latest draft/awaiting order
      const { data: order } = await supabase
        .from("Order")
        .select("*")
        .eq("conversationId", conversationId)
        .in("status", ["draft", "awaiting_confirmation"])
        .order("createdAt", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (order) {
        const orderPatch: any = { updatedAt: new Date().toISOString() };
        if (entities.quantityDozen) orderPatch.quantity = entities.quantityDozen;
        if (entities.size) orderPatch.productSize = entities.size; // Note: Prisma uses productSize or size? 
        if (entities.addressText && !order.deliveryAddress) orderPatch.deliveryAddress = entities.addressText;

        await supabase.from("Order").update(orderPatch).eq("id", order.id);
        log.info("Draft order freshened from background signals", { 
          orderId: order.id, 
          entities 
        });
      }
    }
  } catch (err) {
    log.error("Background signal processing failed", { 
      conversationId, 
      error: err instanceof Error ? err.message : String(err) 
    });
  }
}

async function getOrCreateConversation(phone: string, name: string | null) {
  const { data: existingConversation, error: fetchConversationError } = await supabase
    .from("Conversation")
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
    .from("Conversation")
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
        const { error: insertInboundError } = await supabase.from("Message").insert({
          conversationId: conversation.id,
          sentBy: "CUSTOMER",
          rawText: text,
          direction: "INBOUND",
          providerMessageId: whatsappMsgId,
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

        try {
          await cancelPendingFollowUps(conversation.id, "customer_replied");
        } catch (err) {
          log.warn("Failed to cancel follow-ups", { conversationId: conversation.id, error: err });
        }
      } else {
        log.debug("Retrying webhook flow after optimistic lock conflict", {
          conversationId: conversation.id,
          whatsappMsgId,
          attempt: attempt + 1,
        });
      }

      if (conversation.mode === "human") {
        try {
          await touchConversation(conversation.id);
        } catch (err) {
          log.warn("Failed to touch conversation in human mode", { conversationId: conversation.id, error: err });
        }
        log.info("Conversation in human mode, skipping automation", {
          conversationId: conversation.id,
        });
        return {
          status: "stored_for_human",
          conversation_id: conversation.id,
          whatsapp_msg_id: whatsappMsgId,
        };
      }

      const { text: replyText } = await processSmartReply(conversation.id, text);

      await supabase
        .from("Conversation")
        .update({
          name: (name && conversation.name !== name) ? name : undefined,
          updatedAt: new Date().toISOString()
        })
        .eq("id", conversation.id);

      const sendResult = await sendWhatsAppMessage(phone, replyText);
      const outboundMsgId = sendResult?.messages?.[0]?.id || null;

      if (!outboundMsgId) throw new Error("Meta send succeeded without an outbound message id.");

      // Background Signal Extraction (Non-blocking but awaited for Vercel durability)
      const elapsed = Date.now() - startedAt;
      if (elapsed < 4000) {
        await processBackgroundSignals(conversation.id, text);
      } else {
        log.warn("Skipping background extraction due to latency", { 
          conversationId: conversation.id, 
          elapsed 
        });
      }

      // SIDE EFFECTS: These should NOT crash the main webhook response and trigger Meta retries
      try {
        const { error: insertAssistantError } = await supabase.from("Message").insert({
          conversationId: conversation.id,
          sentBy: "AI",
          rawText: replyText,
          direction: "OUTBOUND",
          providerMessageId: outboundMsgId,
        });

        if (insertAssistantError) {
          log.warn("Assistant message store failed, but message was sent", {
            conversationId: conversation.id,
            error: insertAssistantError.message
          });
        }
      } catch (sideEffectError) {
        log.warn("Webhook side-effect failed (assistant store), continuing to return 200", {
          error: sideEffectError instanceof Error ? sideEffectError.message : String(sideEffectError)
        });
      }

      log.info("Webhook flow completed", {
        conversationId: conversation.id,
        outboundMsgId,
        durationMs: Date.now() - startedAt,
      });

      const result: WebhookResult = {
        status: "replied",
        conversation_id: conversation.id,
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

  // If we have a failure, we still return 200 to Meta to stop retries, 
  // UNLESS the entire system is down (which would likely have thrown a higher-level error).
  if (failed && "error" in failed) {
    log.error("Batch processing had partial or total failure, returning 200 to prevent Meta retry loop", {
      results
    });
    return Response.json(
      {
        status: "processed_with_errors",
        results,
      },
      { status: 200 } // Stop the loop
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
