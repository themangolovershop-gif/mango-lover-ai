import { NextResponse } from "next/server";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { ExecutiveBrainService } from "@/backend/modules/executive/executive-brain.service";

export async function GET() {
  const prisma = getPrismaClient();
  const brain = new ExecutiveBrainService();

  // 1. Get existing insights
  const insights = await prisma.executiveInsight.findMany({
    where: { isDismissed: false },
    orderBy: { impact: "asc" }, // Critical/High first
    take: 10
  });

  // 2. Get Funnel Data
  const funnel = await brain.runGlobalAnalysis();

  return NextResponse.json({
    success: true,
    insights,
    funnel: funnel.funnel,
    revenue: funnel.revenueStats
  });
}
