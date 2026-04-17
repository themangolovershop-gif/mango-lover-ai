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

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("conversation_id", id)
    .in("status", ["draft", "awaiting_confirmation"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (orderError) {
    return NextResponse.json({ error: orderError.message }, { status: 500 });
  }

  if (!order) {
    return NextResponse.json({ error: "No draft order found" }, { status: 404 });
  }

  const { error: updateOrderError } = await supabase
    .from("orders")
    .update({
      status: "confirmed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateOrderError) {
    return NextResponse.json({ error: updateOrderError.message }, { status: 500 });
  }

  const { error: updateConversationError } = await supabase
    .from("conversations")
    .update({
      sales_state: "confirmed",
      lead_tag: "hot",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateConversationError) {
    return NextResponse.json({ error: updateConversationError.message }, { status: 500 });
  }

  try {
    await cancelPendingFollowUps(id, "order_confirmed");
  } catch (error) {
    console.warn("[WH-WARN] Pending follow-up cancellation after confirm failed", error);
  }

  return NextResponse.json({ success: true });
}
