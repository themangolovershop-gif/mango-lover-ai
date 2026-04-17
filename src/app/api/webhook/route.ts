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
    log.warn("WHATSAPP_APP_SECRET is not configured. Webhook signature validation skipped for now, but this is INSECURE for production.");
    return true;
  }

  if (!signature) {
    log.error("Missing x-hub-signature-256 header");
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
    if (name && existingConversation.name !== name) {
      const { error: nameUpdateError } = await supabase
        .from("conversations")
        .update({
          name,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConversation.id);

      if (nameUpdateError) {
        log.warn("Conversation name update skipped", {
          conversationId: existingConversation.id,
          error: nameUpdateError.message,
        });
      } else {
        existingConversation.name = name;
      }
    }

    return existingConversation;
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

  return createdConversation;
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

  try {
    const conversation = await getOrCreateConversation(phone, name);

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

    log.info("Inbound message stored", {
      conversationId: conversation.id,
      whatsappMsgId,
    });

    await cancelPendingFollowUps(conversation.id, "customer_replied");

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

    const draftOrderAfter = await persistDraftOrderPatch({
      conversation: typedConversation,
      existingOrder: draftOrderBefore,
      orderPatch: transition.orderPatch,
    });
    const salesState = transition.nextState;
    const leadTag = transition.leadTag;

    const resetFollowUpCount = stateBefore !== salesState;

    await updateConversationSalesFields({
      conversationId: typedConversation.id,
      salesState,
      leadTag,
      lastCustomerIntent: transition.lastCustomerIntent,
      resetFollowUpCount,
    });

    const conversationAfter: Conversation = {
      ...typedConversation,
      sales_state: salesState,
      lead_tag: leadTag,
      last_customer_intent: transition.lastCustomerIntent,
      follow_up_count: resetFollowUpCount ? 0 : typedConversation.follow_up_count,
    };

    const deterministicReply = buildSalesReply(
      conversationAfter,
      parsed,
      draftOrderAfter,
      text
    );
    const checkoutLocked =
      isLockedCheckoutState(stateBefore) || isLockedCheckoutState(salesState);
    const deterministicHit = deterministicReply !== null;

    log.info("Deterministic sales evaluation", {
      conversationId: typedConversation.id,
      rawInput: text,
      stateBefore,
      stateAfter: salesState,
      deterministicHit,
      aiBlockedBecauseCheckout: checkoutLocked,
      intent: parsed.intent,
    });

    let replyText = "";
    let replyButtons: InteractiveButton[] | undefined = undefined;
    let usedAIFallback = false;

    if (deterministicReply !== null) {
      if (typeof deterministicReply === "object") {
        replyText = deterministicReply.text;
        replyButtons = deterministicReply.buttons;
      } else {
        replyText = deterministicReply;
      }
    } else {
      if (checkoutLocked) {
        replyText = "Please continue your order by sharing the next detail.";
      } else {
        const { data: history, error: historyError } = await supabase
          .from("messages")
          .select("role, content")
          .eq("conversation_id", typedConversation.id)
          .order("created_at", { ascending: true })
          .limit(20);

        if (historyError) {
          throw new Error(`Conversation history fetch failed: ${historyError.message}`);
        }

        log.info("AI fallback requested", {
          conversationId: typedConversation.id,
          historyCount: history?.length ?? 0,
        });

        usedAIFallback = true;

        try {
          replyText = await getAIResponse(
            (history || []).map((item) => ({
              role: item.role as "user" | "assistant",
              content: item.content,
            }))
          );
        } catch (error) {
          log.warn("AI fallback failed, using safe scripted fallback", {
            conversationId: typedConversation.id,
            error: error instanceof Error ? error.message : String(error),
          });
          replyText = buildSafeFallbackReply();
        }
      }
    }

    log.info("Sales engine progression", {
      conversationId: typedConversation.id,
      previousState: stateBefore,
      nextState: salesState,
      intent: parsed.intent,
      hadDraftOrder: !!draftOrderBefore,
      hasDraftOrder: !!draftOrderAfter,
      usedAIFallback,
    });

    if (!replyText) {
      replyText = "Please tell me whether you want pricing or want to place an order.";
    }

    const sendResult = await sendWhatsAppMessage(phone, replyText, replyButtons);
    const outboundMsgId = sendResult?.messages?.[0]?.id || null;

    if (!outboundMsgId) {
      throw new Error("Meta send succeeded without an outbound message id.");
    }

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
    } else if (followUpChoice.message && alreadyPending) {
      log.info("Skipping follow-up schedule because a pending follow-up already exists", {
        conversationId: typedConversation.id,
        requestedReason: followUpChoice.reason,
      });
    }

    await touchConversation(typedConversation.id);

    log.info("Webhook flow completed", {
      conversationId: typedConversation.id,
      outboundMsgId,
      durationMs: Date.now() - startedAt,
      usedAIFallback,
    });

    return {
      status: "replied",
      conversation_id: typedConversation.id,
      outbound_meta_message_id: outboundMsgId,
      whatsapp_msg_id: whatsappMsgId,
    };
  } catch (error) {
    log.error("Critical webhook failure", {
      whatsappMsgId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "failed",
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
    return new Response("Invalid signature", { status: 401 });
  }

  let body: WhatsAppWebhookBody;
  try {
    body = JSON.parse(rawBody) as WhatsAppWebhookBody;
  } catch (error) {
    log.error("Webhook JSON parse failed", error);
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
