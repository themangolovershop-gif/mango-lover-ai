import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { LeadStage } from "@prisma/client";

export type FunnelState = {
  stage: string;
  count: number;
  conversionFromPrevious: number;
};

export class FunnelAnalyzerService {
  private prisma = getPrismaClient();

  async analyzeFunnel(dayRange = 7): Promise<FunnelState[]> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dayRange);

    const stages = [
      "NEW",
      "BROWSING",
      "AWAITING_QUANTITY",
      "AWAITING_ADDRESS",
      "AWAITING_CONFIRMATION",
      "CONFIRMED"
    ];

    const results: FunnelState[] = [];
    let previousCount = 0;

    for (const stage of stages) {
      const count = await this.prisma.lead.count({
        where: {
          stage: stage as LeadStage,
          updatedAt: { gte: startDate }
        }
      });

      const conversion = previousCount === 0 ? 100 : (count / previousCount) * 100;
      
      results.push({
        stage,
        count,
        conversionFromPrevious: Math.min(100, parseFloat(conversion.toFixed(1)))
      });

      previousCount = count;
    }

    return results;
  }
}
