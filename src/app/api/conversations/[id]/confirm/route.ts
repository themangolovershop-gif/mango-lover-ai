import { LeadStage, OrderStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { cancelPendingFollowUpsForConversation } from "@/backend/modules/followups/follow-up.service";
import { updateOrder } from "@/backend/modules/orders/order.service";
import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const prisma = getPrismaClient();

    const order = await prisma.order.findFirst({
      where: {
        conversationId: id,
        status: {
          in: [OrderStatus.DRAFT, OrderStatus.AWAITING_CONFIRMATION],
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!order) {
      return NextResponse.json({ error: "No draft order found" }, { status: 404 });
    }

    await updateOrder(order.id, {
      status: OrderStatus.CONFIRMED,
    });

    await prisma.conversation.update({
      where: {
        id,
      },
      data: {
        currentStage: LeadStage.CONFIRMED,
        buyerType: "hot",
      },
    });

    try {
      await cancelPendingFollowUpsForConversation(id, "order_confirmed");
    } catch (error) {
      console.warn("[WH-WARN] Pending follow-up cancellation after confirm failed", error);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to confirm order" },
      { status: 500 }
    );
  }
}
