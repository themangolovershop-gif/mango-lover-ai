import { getPrismaClient } from "@/backend/shared/lib/prisma";

export class DropOffEngine {
  async getFunnelStats() {
    const prisma = getPrismaClient();

    const counts = await prisma.lead.groupBy({
      by: ["stage"],
      _count: { _all: true }
    });

    const stats: Record<string, number> = {};
    counts.forEach(c => {
      stats[c.stage] = c._count._all;
    });

    return {
      totalLeads: counts.reduce((sum, c) => sum + c._count._all, 0),
      byStage: stats,
      criticalFrictionPoints: this.identifyFriction(stats)
    };
  }

  private identifyFriction(stats: Record<string, number>) {
    const order = ["NEW_INQUIRY", "ENGAGED", "QUALIFIED", "AWAITING_DETAILS", "AWAITING_PAYMENT", "CONFIRMED"];
    const friction: { stage: string, dropRate: number }[] = [];

    for (let i = 0; i < order.length - 1; i++) {
      const current = stats[order[i]] || 0;
      const next = stats[order[i+1]] || 0;
      if (current > 0) {
        const dropRate = ((current - next) / current) * 100;
        friction.push({ stage: order[i], dropRate });
      }
    }

    return friction.sort((a, b) => b.dropRate - a.dropRate);
  }
}
