import { NextResponse } from "next/server";
import { cancelPendingFollowUps } from "@/lib/followups";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { error } = await supabase
    .from("conversations")
    .update({
      mode: "human",
      sales_state: "human_handoff",
      lead_tag: "human_required",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await cancelPendingFollowUps(id, "human_handoff");
  } catch (error) {
    console.warn("[WH-WARN] Pending follow-up cancellation after handoff failed", error);
  }

  return NextResponse.json({ success: true });
}
