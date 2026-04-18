import { NextRequest, NextResponse } from "next/server";
import { getPrismaClient } from "@/backend/shared/lib/prisma";
import { LeadStage } from "@prisma/client";

export async function POST(req: NextRequest) {
  const prisma = getPrismaClient();
  const { customerId, summary, nextStage, nextBestAction } = await req.json();

  try {
    // 1. Update Customer Memory with interaction summary
    await (prisma as any).customerMemory.upsert({
      where: { customerId },
      update: { lastSummary: summary },
      create: { customerId, profileJson: {}, lastSummary: summary }
    });

    // 2. Log Analytic Event
    await prisma.analyticsEvent.create({
      data: {
        customerId,
        eventType: "manual_interaction_log",
        payloadJson: { summary, nextBestAction }
      }
    });

    // 3. Update Lead State if provided
    if (nextStage) {
      await prisma.lead.updateMany({
        where: { customerId },
        data: { stage: nextStage as LeadStage }
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
