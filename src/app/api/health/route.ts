import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/health
 * Returns connection status for WhatsApp, Database, AI, and Webhook services.
 * Used by the dashboard header health strip.
 */
export async function GET() {
  const results = await Promise.allSettled([
    // DB: ping with a minimal query
    supabase.from("Conversation").select("id", { count: "exact", head: true }),
    // WhatsApp: check env is populated
    Promise.resolve(
      process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
        ? { ok: true }
        : { ok: false, error: "WHATSAPP credentials missing" }
    ),
    // AI: check the active provider credentials
    Promise.resolve(
      process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
        ? { ok: true }
        : { ok: false, error: "AI provider credentials not set" }
    ),
    // Webhook: check for WHATSAPP_APP_SECRET
    Promise.resolve(
      process.env.WHATSAPP_APP_SECRET
        ? { ok: true }
        : { ok: false, error: "WHATSAPP_APP_SECRET not set" }
    ),
  ]);

  function toStatus(r: PromiseSettledResult<unknown>, index: number): "green" | "amber" | "red" {
    if (r.status === "rejected") return "red";
    // DB result has error field from Supabase
    if (index === 0) {
      const v = (r as PromiseFulfilledResult<{ error: unknown }>).value;
      return v.error ? "red" : "green";
    }
    const v = (r as PromiseFulfilledResult<{ ok: boolean; error?: string }>).value;
    return v.ok ? "green" : "amber";
  }

  return NextResponse.json({
    db:      toStatus(results[0]!, 0),
    wa:      toStatus(results[1]!, 1),
    ai:      toStatus(results[2]!, 2),
    webhook: toStatus(results[3]!, 3),
  });
}
