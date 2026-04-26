import "server-only";

import { supabase } from "@/lib/supabase";

export type MessageRole = "user" | "assistant";
export type ChatMessage = { role: MessageRole; content: string };

function clampHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 10;
  }

  return Math.min(12, Math.max(8, Math.floor(limit)));
}

function normalizeMessageRole(role: string | null | undefined): MessageRole | null {
  if (role === "user" || role === "assistant") {
    return role;
  }

  return null;
}

function normalizeMessageContent(content: unknown): string | null {
  if (typeof content !== "string") {
    return null;
  }

  const normalized = content.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeForComparison(content: string): string {
  return content.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function loadConversationHistory(
  conversationId: string,
  limit = 10
): Promise<ChatMessage[]> {
  const historyLimit = clampHistoryLimit(limit);
  const { data, error } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(historyLimit);

  if (error) {
    console.error(`[SmartReply] Conversation history load failed for ${conversationId}`, error);
    return [];
  }

  return (data || [])
    .reverse()
    .map((message) => {
      const role = normalizeMessageRole(message.role);
      const content = normalizeMessageContent(message.content);

      if (!role || !content) {
        return null;
      }

      return {
        role,
        content,
      } satisfies ChatMessage;
    })
    .filter((message): message is ChatMessage => message !== null);
}

export function getRecentAssistantReplies(
  history: ChatMessage[],
  limit = 3
): string[] {
  return history
    .filter((message) => message.role === "assistant")
    .slice(-limit)
    .map((message) => message.content);
}

export function stripLatestInboundFromHistory(
  history: ChatMessage[],
  latestUserMessage: string
): ChatMessage[] {
  if (history.length === 0) {
    return history;
  }

  const lastMessage = history[history.length - 1];
  if (lastMessage.role !== "user") {
    return history;
  }

  if (
    normalizeForComparison(lastMessage.content) !==
    normalizeForComparison(latestUserMessage)
  ) {
    return history;
  }

  return history.slice(0, -1);
}
