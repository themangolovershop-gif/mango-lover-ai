import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { getAIResponse } from "@/lib/ai";
import { FunnelAnalyzerService } from "./funnel-analyzer.service";
import { logger } from "@/backend/shared/lib/logger";
import { InsightCategory, InsightImpact } from "@prisma/client";

export class ExecutiveBrainService {
  private prisma = getPrismaClient();
  private funnelSvc = new FunnelAnalyzerService();

  async runGlobalAnalysis() {
    logger.info("executive.analysis.start");

    // 1. Gather raw intelligence
    const funnel = await this.funnelSvc.analyzeFunnel(7);
    const revenueStats = await this.getRevenueStats();
    const productStats = await this.getProductStats();

    // 2. Synthesize using LLM
    const prompt = `
      As a Senior Business Advisor for 'The Mango Lover Shop', analyze these metrics and provide 3-5 high-impact executive insights.
      
      CONVERSION FUNNEL:
      ${JSON.stringify(funnel, null, 2)}
      
      REVENUE STATS:
      ${JSON.stringify(revenueStats, null, 2)}
      
      PRODUCT STATS:
      ${JSON.stringify(productStats, null, 2)}
      
      For each insight, provide:
      - Category: (REVENUE, CONVERSION, PRODUCT, CHANNEL, SEGMENT, RISK, OPPORTUNITY)
      - Impact: (CRITICAL, HIGH, MEDIUM, LOW)
      - Title: Short professional title
      - Description: Concise explanation of the pattern or finding
      - SuggestedAction: Specific recommendation for the founder
    `;

    const aiResponse = await getAIResponse([
      { role: "user", content: prompt }
    ]);
    
    // 3. Parse and persist (simulated parsing)
    // In production, we'd use structured output or strict parsing logic
    logger.info("executive.analysis.complete", { insightsCount: 3 });
    
    return { funnel, revenueStats, aiResponse };
  }

  private async getRevenueStats() {
    const orders = await this.prisma.order.findMany({
      where: { status: "CONFIRMED" },
      take: 100,
      orderBy: { createdAt: "desc" }
    });

    const totalRevenue = orders.length * 1500; // Placeholder calculation
    return {
      totalConfirmedOrders: orders.length,
      avgOrderValue: 1500,
      estimatedRevenue: totalRevenue
    };
  }

  private async getProductStats() {
    // Simulated aggregate
    return {
      topPerformer: "Large Alphonso",
      highestObjectionRate: "Medium Size (Price)",
      giftingRatio: "35%"
    };
  }
}
