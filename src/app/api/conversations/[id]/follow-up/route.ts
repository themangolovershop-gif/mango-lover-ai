import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const message = body?.message?.trim();
  const scheduledFor = body?.scheduled_for;

  if (!message || !scheduledFor) {
    return NextResponse.json(
      { error: "message and scheduled_for are required" },
      { status: 400 }
    );
  }

  const { data: conversation, error: convoError } = await supabase
    .from("conversations")
    .select("id, phone")
    .eq("id", id)
    .single();

  if (convoError || !conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("follow_ups")
    .insert({
      conversation_id: id,
      phone: conversation.phone,
      message,
      scheduled_for: scheduledFor,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
