import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const conversationId = searchParams.get("conversation_id");

  let query = supabase
    .from("follow_ups")
    .select("*")
    .order("scheduled_for", { ascending: true });

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}


export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { conversation_id, phone, message, scheduled_for } = body;

    if (!conversation_id || !phone || !message || !scheduled_for) {
      return NextResponse.json(
        { error: "Missing required fields: conversation_id, phone, message, scheduled_for" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("follow_ups")
      .insert([
        {
          conversation_id,
          phone,
          message,
          scheduled_for: new Date(scheduled_for).toISOString(),
          status: "pending",
        },
      ])
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}
