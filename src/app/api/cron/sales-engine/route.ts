import { NextRequest, NextResponse } from "next/server";
import { AutonomousSalesService } from "@/backend/modules/sales-engine/autonomous-sales.service";
import { ActionExecutorService } from "@/backend/modules/sales-engine/action-executor.service";
import { logger } from "@/backend/shared/lib/logger";

export async function GET(req: NextRequest) {
  // Simple auth check for cron
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const salesService = new AutonomousSalesService();
  const executor = new ActionExecutorService();

  try {
    logger.info("cron.sales_engine.start");
    
    // 1. Analyze and Queue
    await salesService.runBatch();
    
    // 2. Execute pending actions
    await executor.processQueue();

    return NextResponse.json({ success: true, timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("cron.sales_engine.failed", { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
