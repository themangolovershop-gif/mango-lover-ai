import { NextResponse } from "next/server";
import { getPrismaClient } from "@/backend/shared/lib/prisma";

export async function GET() {
  const prisma = getPrismaClient();

  // Get Top leads based on priority score in tagsJson
  // Note: Since tagsJson is a generic Json type, we'll fetch and sort in memory for simplicity or use a raw query
  const leads = await prisma.lead.findMany({
    where: {
      stage: { notIn: ["CONFIRMED", "LOST"] }
    },
    include: {
      customer: true
    },
    orderBy: { score: "desc" },
    take: 50
  });

  const formatted = leads.map(l => ({
    id: l.id,
    customerName: l.customer.name,
    phone: l.customer.phone,
    score: l.score,
    stage: l.stage,
    temperature: l.temperature,
    priorityLevel: (l.tagsJson as any)?.priorityLevel || 4
  }));

  return NextResponse.json({
    success: true,
    data: formatted
  });
}
