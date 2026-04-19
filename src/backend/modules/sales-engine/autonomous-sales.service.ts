import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { PriorityEngine } from "./priority.engine";
import { FollowUpEngine } from "./follow-up.engine";
import { ReorderEngine } from "./reorder.engine";
import { SalesSafetyLayer } from "./safety.service";
import { LeadIntelligence, SalesOpportunity } from "./types";
import { logger } from "@/backend/shared/lib/logger";
import { mapPrismaLeadStageToDerived } from "@/backend/modules/leads/stage.service";

export class AutonomousSalesService {
  private prisma = getPrismaClient();
  private priority = new PriorityEngine();
  private followUp = new FollowUpEngine();
  private reorder = new ReorderEngine();
  private safety = new SalesSafetyLayer();

  async analyzeLead(leadId: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id: leadId },
      include: { 
        customer: { include: { memory: true } },
        orders: { orderBy: { createdAt: "desc" }, take: 1 }
      }
    });

    if (!lead) return;

    logger.info("sales_engine.analyzing_lead", { leadId: lead.id });

    // 1. Build Intelligence
    const lastMsg = await this.prisma.message.findFirst({
      where: { conversationId: lead.conversationId },
      orderBy: { createdAt: "desc" }
    });

    const intel: LeadIntelligence = {
      leadScore: lead.score,
      temperature: lead.temperature,
      buyerType: lead.buyerType,
      stage: mapPrismaLeadStageToDerived(lead.stage),
      quantityValue: lead.orders[0]?.totalAmount ? Number(lead.orders[0].totalAmount) : 0,
      lastInteractionDays: lastMsg 
        ? (Date.now() - lastMsg.createdAt.getTime()) / (1000 * 60 * 60 * 24)
        : 99,
      vipScore: lead.customer.memory?.vipScore || 0
    };

    // 2. Run Engines
    const priorityScore = this.priority.calculateScore(intel);
    const followUps = this.followUp.process(intel);
    const reorders = this.reorder.process(intel, lead.orders[0]);

    const opportunities = [...followUps.opportunities, ...reorders.opportunities];

    // 3. Queue Safe Actions
    for (const opp of opportunities) {
      if (await this.safety.isSafe(lead.customerId, opp.actionType)) {
        await this.prisma.salesActionQueue.create({
          data: {
            customerId: lead.customerId,
            leadId: lead.id,
            conversationId: lead.conversationId,
            actionType: opp.actionType,
            status: "PENDING",
            priority: opp.priority,
            reason: opp.reason,
            payloadJson: opp.metadata || {},
            scheduledAt: new Date(Date.now() + 1000 * 60 * 5) // Schedule for 5 mins from now
          }
        });
        
        logger.info("sales_engine.opportunity_queued", { 
          leadId: lead.id, 
          action: opp.actionType 
        });
      }
    }

    // 4. Update Lead Priority
    await this.prisma.lead.update({
      where: { id: lead.id },
      data: { 
        score: Math.round(priorityScore),
        tagsJson: { 
          ...(lead.tagsJson as object || {}), 
          priorityLevel: this.priority.getPriorityLevel(priorityScore) 
        }
      }
    });
  }

  async runBatch() {
    // Process all active leads
    const activeLeads = await this.prisma.lead.findMany({
      where: { 
        stage: { notIn: ["CONFIRMED", "LOST", "HUMAN_HANDOFF"] },
        updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
      }
    });

    for (const lead of activeLeads) {
      await this.analyzeLead(lead.id);
    }
  }
}
