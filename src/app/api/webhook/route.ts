import { NextRequest } from "next/server";
import crypto from "crypto";
import { ConversationStatus, MessageSender, OrderStatus, Prisma } from "@prisma/client";

import { extractEntities } from "@/backend/modules/ai/entity.service";
import { cancelPendingFollowUpsForConversation } from "@/backend/modules/followups/follow-up.service";
import { createOrder, getLatestConversationOrder, updateOrder } from "@/backend/modules/orders/order.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { AGENT_VERSION } from "@/backend/shared/version";
import { normalizeMessage } from "@/backend/shared/utils/normalization";
import { getActiveProductBySize } from "@/backend/modules/products/product.service";
import { mapSizeToProductSize } from "@/backend/modules/products/product-helpers";
import { sendOutboundWhatsAppMessage } from "@/backend/modules/whatsapp/outbound.service";
import type { ParsedInboundWhatsAppMessage } from "@/backend/modules/whatsapp/provider";
import { persistInboundWhatsAppMessage } from "@/backend/modules/whatsapp/service";
import { masterAgent } from "@/backend/modules/agents/master-agent.service";
import { detectIntents } from "@/backend/modules/ai/intent.service";
import { syncCustomerMemoryContext } from "@/backend/modules/memory/memory.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prisma = getPrismaClient();

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
  try {
    await prisma.conversation.update({
      where: {
        id: conversationId,
      },
      data: {
        lastInboundAt: new Date(),
      },
    });
  } catch (error) {
    log.warn("Conversation timestamp update failed", {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
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
    const enhancedPayload =
      typeof params.payload === "object" && params.payload !== null
        ? { ...params.payload, agent_version: AGENT_VERSION }
        : { raw: params.payload ?? null, agent_version: AGENT_VERSION };

    await prisma.webhookLog.create({
      data: {
        whatsappMsgId: params.whatsapp_msg_id || null,
        phone: params.phone || null,
        status: params.status,
        payload: enhancedPayload as Prisma.InputJsonValue,
        error: params.error || null,
        durationMs: params.duration_ms || null,
      },
    });
  } catch (err) {
    log.error("Internal error during webhook logging", err);
  }
}

/**
 * Background worker to extract entities and update dashboard signals
 * without blocking the main reply flow.
 */
async function processBackgroundSignals(args: {
  conversationId: string;
  customerId: string;
  leadId: string | null;
  text: string;
}) {
  try {
    const normalizedText = normalizeMessage(args.text);
    const entities = extractEntities(normalizedText);

    // 1. Update conversation-level tag signals used by the dashboard.
    if (entities.gifting || entities.urgency) {
      await prisma.conversation.update({
        where: {
          id: args.conversationId,
        },
        data: {
          buyerType: entities.gifting ? "gift_lead" : "hot",
        },
      });
    }

    // 2. Update draft order line items if size/quantity signals are present.
    if (!args.leadId || (!entities.quantityDozen && !entities.size)) {
      return;
    }

    const latestOrder = await getLatestConversationOrder(args.conversationId);
    if (
      latestOrder &&
      !([OrderStatus.DRAFT, OrderStatus.AWAITING_CONFIRMATION] as OrderStatus[]).includes(latestOrder.status)
    ) {
      return;
    }

    const existingItem = latestOrder?.items[0];
    const quantity = entities.quantityDozen ?? existingItem?.quantity ?? null;
    const targetProductSize = mapSizeToProductSize(entities.size);
    const resolvedProduct =
      targetProductSize !== null
        ? await getActiveProductBySize(targetProductSize)
        : existingItem
          ? { id: existingItem.productId }
          : null;

    if (!resolvedProduct || quantity === null) {
      return;
    }

    if (latestOrder) {
      await updateOrder(latestOrder.id, {
        items: [
          {
            productId: resolvedProduct.id,
            quantity,
          },
        ],
      });

      log.info("Draft order freshened from background signals", {
        orderId: latestOrder.id,
        entities,
      });
      return;
    }

    const createdOrder = await createOrder({
      customerId: args.customerId,
      conversationId: args.conversationId,
      leadId: args.leadId,
      items: [
        {
          productId: resolvedProduct.id,
          quantity,
        },
      ],
    });

    log.info("Draft order created from background signals", {
      orderId: createdOrder.id,
      entities,
    });
  } catch (err) {
    log.error("Background signal processing failed", {
      conversationId: args.conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function loadConversationContext(conversationId: string) {
  return prisma.conversation.findUnique({
    where: {
      id: conversationId,
    },
    include: {
      customer: true,
      lead: {
        select: {
          id: true,
        },
      },
    },
  });
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

  try {
    const inboundMessage: ParsedInboundWhatsAppMessage = {
      provider: "meta",
      providerMessageId: whatsappMsgId,
      from: phone,
      profileName: name,
      body: text,
      rawPayload: {
        from: phone,
        providerMessageId: whatsappMsgId,
        body: text,
      },
      receivedAt: new Date(),
    };

    const persistenceResult = await persistInboundWhatsAppMessage(inboundMessage);

    if (persistenceResult.status === "duplicate") {
      log.info("Duplicate inbound WhatsApp message ignored", {
        whatsappMsgId,
        phone,
      });
      return {
        status: "duplicate",
        conversation_id: persistenceResult.conversationId,
        whatsapp_msg_id: whatsappMsgId,
      };
    }

    if (persistenceResult.status === "ignored_empty_body") {
      return {
        status: "ignored_malformed_text",
        whatsapp_msg_id: whatsappMsgId,
      };
    }

    const conversation = await loadConversationContext(persistenceResult.conversationId);
    if (!conversation) {
      throw new Error(`Conversation ${persistenceResult.conversationId} was not found after inbound persistence.`);
    }

    log.info("Inbound message stored", {
      conversationId: conversation.id,
      whatsappMsgId,
    });

    try {
      await cancelPendingFollowUpsForConversation(conversation.id, "customer_replied");
    } catch (err) {
      log.warn("Failed to cancel follow-ups", {
        conversationId: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (conversation.status === ConversationStatus.PENDING_HUMAN) {
      try {
        await touchConversation(conversation.id);
      } catch (err) {
        log.warn("Failed to touch conversation in human mode", {
          conversationId: conversation.id,
          error: err instanceof Error ? err.message : String(err),
        });
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

    // Prepare context for Intelligence Engine
    const normalizedText = normalizeMessage(text);
    const entities = extractEntities(normalizedText);
    const intentResult = detectIntents(text);
    const latestOrder = await getLatestConversationOrder(conversation.id);

    const memory = await syncCustomerMemoryContext({
      customerId: conversation.customerId,
      conversationId: conversation.id,
      phone,
      leadStage: conversation.lead?.stage ?? "COLD",
      buyerType: conversation.buyerType,
      intents: [intentResult.primaryIntent, ...intentResult.secondaryIntents],
      latestUserMessage: text,
      latestOrder,
    });

    const agentResult = await masterAgent.process({
      conversationId: conversation.id,
      customerId: conversation.customerId,
      leadId: conversation.lead?.id ?? null,
      phone,
      latestUserMessage: text,
      intents: [intentResult.primaryIntent, ...intentResult.secondaryIntents],
      entities,
      leadStage: conversation.lead?.stage ?? "COLD",
      buyerType: conversation.buyerType,
      latestOrder,
      memorySnapshot: memory,
      groundingSnapshot: null,
    });

    const replyText = agentResult.responseText;
    const outboundResult = await sendOutboundWhatsAppMessage({
      conversationId: conversation.id,
      body: replyText,
      sentBy: MessageSender.AI,
      phone,
    });
    const outboundMsgId = outboundResult.providerMessageId;

    if (!outboundMsgId) {
      throw new Error("Meta send succeeded without an outbound message id.");
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < 4000) {
      await processBackgroundSignals({
        conversationId: conversation.id,
        customerId: conversation.customerId,
        leadId: conversation.lead?.id ?? null,
        text,
      });
    } else {
      log.warn("Skipping background extraction due to latency", {
        conversationId: conversation.id,
        elapsed,
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
