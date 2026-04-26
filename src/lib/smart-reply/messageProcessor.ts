import {
  getRecentAssistantReplies,
  loadConversationHistory,
  stripLatestInboundFromHistory,
} from "./conversationHistory";
import { generateSmartReply } from "./aiReplyService";

export async function processSmartReply(
  conversationId: string,
  latestUserMessage: string
): Promise<{ text: string }> {
  const fullHistory = await loadConversationHistory(conversationId, 12);
  const promptHistory = stripLatestInboundFromHistory(fullHistory, latestUserMessage);
  const recentAssistantReplies = getRecentAssistantReplies(fullHistory, 3);
  const replyText = await generateSmartReply({
    history: promptHistory,
    latestUserMessage,
    recentAssistantReplies,
  });

  return { text: replyText };
}
