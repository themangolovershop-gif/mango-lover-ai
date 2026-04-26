import { NextResponse } from "next/server";

import { getPrismaClient } from "@/backend/shared/lib/prisma";

export const dynamic = "force-dynamic";

function mapWebhookStatus(status: string) {
  if (status === "signature_failed") {
    return "signature_failed" as const;
  }

  if (status === "failed" || status.endsWith("_failed")) {
    return "error" as const;
  }

  return "success" as const;
}

export async function GET() {
  try {
    const prisma = getPrismaClient();
    const data = await prisma.webhookLog.findMany({
      orderBy: {
        createdAt: "desc",
      },
      take: 100,
    });

    return NextResponse.json(
      data.map((log) => ({
        id: log.id,
        whatsapp_msg_id: log.whatsappMsgId,
        phone: log.phone,
        status: mapWebhookStatus(log.status),
        payload: log.payload,
        error: log.error,
        duration_ms: log.durationMs,
        created_at: log.createdAt.toISOString(),
      }))
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load webhook logs" },
      { status: 500 }
    );
  }
}
