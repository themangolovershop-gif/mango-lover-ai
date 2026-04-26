import { ConversationStatus, FollowUpStatus, MessageDirection, MessageSender } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  cancelFollowUp,
  listDueFollowUps,
  markFollowUpFailed,
  markFollowUpSent,
} from "@/backend/modules/followups/follow-up.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { sendOutboundWhatsAppMessage } from "@/backend/modules/whatsapp/outbound.service";

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
    const prisma = getPrismaClient();
    const pending = await listDueFollowUps(new Date(), 20);

    log.info("Cron follow-up batch loaded", {
      pendingCount: pending.length,
    });

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const item of pending) {
      try {
        const conversation = await prisma.conversation.findUnique({
          where: {
            id: item.conversationId,
          },
          include: {
            customer: true,
          },
        });

        if (!conversation) {
          await cancelFollowUp(item.id, "conversation_missing");
          results.push({
            id: item.id,
            status: "cancelled_conversation_missing",
          });
          continue;
        }

        if (conversation.status === ConversationStatus.PENDING_HUMAN) {
          await cancelFollowUp(item.id, "conversation_in_human_mode");
          results.push({
            id: item.id,
            status: "cancelled_human_mode",
          });
          continue;
        }

        const customerReplied = await prisma.message.findFirst({
          where: {
            conversationId: item.conversationId,
            direction: MessageDirection.INBOUND,
            createdAt: {
              gt: item.createdAt,
            },
          },
          select: {
            id: true,
          },
        });

        if (customerReplied) {
          await cancelFollowUp(item.id, "customer_replied_after_schedule");
          results.push({
            id: item.id,
            status: "cancelled_stale",
          });
          continue;
        }

        if (!item.suggestedMessage?.trim()) {
          await markFollowUpFailed(item.id, "missing_follow_up_message");
          results.push({
            id: item.id,
            status: "missing_message",
          });
          continue;
        }

        await sendOutboundWhatsAppMessage({
          conversationId: item.conversationId,
          body: item.suggestedMessage,
          sentBy: MessageSender.SYSTEM,
          phone: conversation.customer.phone,
        });

        await markFollowUpSent(item.id, "sent");
        results.push({
          id: item.id,
          status: "sent",
        });
      } catch (error) {
        log.error("Follow-up send failed", {
          followUpId: item.id,
          error: error instanceof Error ? error.message : String(error),
        });

        try {
          if (item.status === FollowUpStatus.PENDING) {
            await markFollowUpFailed(
              item.id,
              error instanceof Error ? error.message : String(error)
            );
          }
        } catch (markError) {
          log.warn("Failed to mark follow-up as failed", {
            followUpId: item.id,
            error: markError instanceof Error ? markError.message : String(markError),
          });
        }

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
