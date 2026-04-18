import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { SalesActionType } from "@prisma/client";

export class SalesSafetyLayer {
  async isSafe(customerId: string, actionType: SalesActionType): Promise<boolean> {
    const prisma = getPrismaClient();

    // 1. One proactive message per 24 hours
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActions = await prisma.salesActionQueue.count({
      where: {
        customerId,
        status: "SENT",
        sentAt: { gte: last24h }
      }
    });

    if (recentActions > 0) return false;

    // 2. Don't send payment reminders if a recent payment was submitted
    if (actionType === "SEND_PAYMENT_REMINDER") {
      const recentPayments = await prisma.payment.count({
        where: {
          order: { customerId },
          status: { in: ["SUBMITTED", "VERIFIED"] },
          createdAt: { gte: last24h }
        }
      });
      if (recentPayments > 0) return false;
    }

    // 3. Don't nudge if the user actually replied recently (e.g. within 2 hours)
    const last2h = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const recentMessages = await prisma.message.count({
      where: {
        conversation: { customerId },
        direction: "INBOUND",
        createdAt: { gte: last2h }
      }
    });

    if (recentMessages > 0) return false;

    return true;
  }
}
