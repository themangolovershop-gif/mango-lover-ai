import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { getAIResponse } from "@/lib/ai";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { logger } from "@/backend/shared/lib/logger";

export class ActionExecutorService {
  private prisma = getPrismaClient();

  async processQueue() {
    const pendingActions = await this.prisma.salesActionQueue.findMany({
      where: {
        status: "PENDING",
        scheduledAt: { lte: new Date() }
      },
      include: {
        customer: { include: { conversations: { orderBy: { updatedAt: "desc" }, take: 1 } } }
      },
      orderBy: { priority: "asc" },
      take: 10
    });

    for (const action of pendingActions) {
      try {
        logger.info("action_executor.processing", { actionId: action.id, type: action.actionType });

        const phone = action.customer.phone;
        const lastConv = action.customer.conversations[0];
        
        if (!lastConv) {
          await this.prisma.salesActionQueue.update({
            where: { id: action.id },
            data: { status: "SKIPPED", error: "No active conversation found." }
          });
          continue;
        }

        // Generate Personalized Message
        const prompt = `
          ACTION_TYPE: ${action.actionType}
          REASON: ${action.reason}
          CONTEXT: ${JSON.stringify(action.payloadJson)}
          
          TASK:
          Generate a short, helpful, and non-spammy proactive message to re-engage this customer.
          Follow the brand tone: premium, warm, personal.
        `;

        const replyText = await getAIResponse([{ role: "user", content: prompt }]);

        // Send
        await sendWhatsAppMessage(phone, replyText);

        // Update Queue
        await this.prisma.salesActionQueue.update({
          where: { id: action.id },
          data: { 
            status: "SENT",
            sentAt: new Date()
          }
        });

        // Record Analytics
        await this.prisma.analyticsEvent.create({
          data: {
            customerId: action.customerId,
            conversationId: action.conversationId,
            leadId: action.leadId,
            eventType: "autonomous_action_sent",
            payloadJson: { actionType: action.actionType, result: "success" }
          }
        });

      } catch (err) {
        logger.error(`action_executor.failed: ${action.id}`, { error: String(err) });
        await this.prisma.salesActionQueue.update({
          where: { id: action.id },
          data: { status: "FAILED", error: String(err) }
        });
      }
    }
  }
}
