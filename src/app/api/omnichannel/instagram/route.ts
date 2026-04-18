import { NextRequest, NextResponse } from "next/server";
import { IdentityResolutionService } from "@/backend/modules/omnichannel/identity-resolution";
import { MasterAgent } from "@/backend/modules/agents/master-agent.service";
import { logger } from "@/backend/shared/lib/logger";

export async function POST(req: NextRequest) {
  try {
    const { handle, text } = await req.json();

    const identitySvc = new IdentityResolutionService();
    const masterAgent = new MasterAgent();

    // 1. Resolve Identity (Simulated)
    const customer = await identitySvc.resolve({ handle, provider: "instagram" });

    // 2. Load context (Simulated)
    const context = {
      conversation: { id: "ig-" + handle, channel: "INSTAGRAM" } as any,
      latestMessage: text,
      analysis: { intents: ["browsing"], temperature: "warm", buyerType: "uncertain" },
      recentHistory: "",
      customer: customer || { name: handle }
    };

    // 3. Process with Master Agent
    const result = await masterAgent.process(context as any);

    // 4. Adaptation: Slightly friendlier for IG
    const adaptedReply = `Hi @${handle}! 🍐 ${result.responseText}`;

    return NextResponse.json({ 
      success: true, 
      reply: adaptedReply,
      linkedCustomer: customer?.name || "New Lead"
    });

  } catch (err) {
    logger.error("omnichannel.instagram.failed", { error: String(err) });
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
