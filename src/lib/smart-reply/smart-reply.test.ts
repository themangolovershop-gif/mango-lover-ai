import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSmartReply } from "./aiReplyService";
import { SAFE_FALLBACK_REPLY, SMART_REPLY_SYSTEM_PROMPT } from "./promptBuilder";
import { isRepeating } from "./repeatGuard";

const { completionCreate } = vi.hoisted(() => ({
  completionCreate: vi.fn(),
}));

function getLatestUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) {
    return "";
  }

  const latestUserMessage = [...messages]
    .reverse()
    .find(
      (message): message is { role: string; content: string } =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        "content" in message &&
        typeof (message as { role?: unknown }).role === "string" &&
        typeof (message as { content?: unknown }).content === "string" &&
        (message as { role: string }).role === "user"
    );

  return latestUserMessage?.content.trim().toLowerCase() || "";
}

function replyForMessage(latestUserMessage: string): string {
  switch (latestUserMessage) {
    case "hi":
      return "Hi! Welcome to The Mango Lover Shop. What are you looking for today?";
    case "price?":
      return "We have Medium, Large, and Jumbo Devgad Alphonso options. If you want, I can help you choose the best size for you.";
    case "natural hai?":
      return "Yes, our Devgad Alphonso mangoes are naturally ripened and carbide-free.";
    case "which is best?":
      return "Large gives the best overall balance for most buyers. Jumbo is usually best if you're buying for gifting.";
    case "what did i order?":
      return "I don't see your latest order details in this chat yet. If you want, tell me the last order detail you remember and I'll help.";
    case "start again":
      return "Sure, we can start fresh. Tell me what you'd like help with.";
    case "payment done":
      return "Noted. If you want, send the payment reference or screenshot and I'll help from there.";
    case "random mango question":
      return "Devgad Alphonso is known for its rich aroma, sweet taste, and smooth texture.";
    default:
      return "Happy to help with mangoes, pricing, delivery, or order support. What would you like to know?";
  }
}

vi.mock("@/lib/ai", () => ({
  getAIConfig: vi.fn(() => ({ model: "test-model" })),
  getOpenAIClient: vi.fn(() => ({
    chat: {
      completions: {
        create: completionCreate,
      },
    },
  })),
}));

describe("Smart Reply AI Assistant", () => {
  beforeEach(() => {
    completionCreate.mockReset();
    completionCreate.mockImplementation(async ({ messages }: { messages: unknown }) => ({
      choices: [
        {
          message: {
            content: replyForMessage(getLatestUserMessage(messages)),
          },
        },
      ],
    }));
  });

  it("builds AI messages with the system prompt, history, and latest user message", async () => {
    await generateSmartReply({
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello! How can I help?" },
      ],
      latestUserMessage: "price?",
      recentAssistantReplies: [],
    });

    expect(completionCreate).toHaveBeenCalledTimes(1);
    const request = completionCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };

    expect(request.messages[0]).toEqual({
      role: "system",
      content: SMART_REPLY_SYSTEM_PROMPT,
    });
    expect(request.messages).toContainEqual({
      role: "assistant",
      content: "Hello! How can I help?",
    });
    expect(request.messages.at(-1)).toEqual({
      role: "user",
      content: "price?",
    });
  });

  it.each([
    ["hi", "Hi! Welcome to The Mango Lover Shop. What are you looking for today?"],
    [
      "price?",
      "We have Medium, Large, and Jumbo Devgad Alphonso options. If you want, I can help you choose the best size for you.",
    ],
    [
      "natural hai?",
      "Yes, our Devgad Alphonso mangoes are naturally ripened and carbide-free.",
    ],
    [
      "which is best?",
      "Large gives the best overall balance for most buyers. Jumbo is usually best if you're buying for gifting.",
    ],
    [
      "what did I order?",
      "I don't see your latest order details in this chat yet. If you want, tell me the last order detail you remember and I'll help.",
    ],
    ["start again", "Sure, we can start fresh. Tell me what you'd like help with."],
    [
      "payment done",
      "Noted. If you want, send the payment reference or screenshot and I'll help from there.",
    ],
    [
      "random mango question",
      "Devgad Alphonso is known for its rich aroma, sweet taste, and smooth texture.",
    ],
  ])("handles user message %s", async (latestUserMessage, expectedReply) => {
    const reply = await generateSmartReply({
      history: [],
      latestUserMessage,
      recentAssistantReplies: [],
    });

    expect(reply).toBe(expectedReply);
    expect(reply.split(/[.!?]+/).filter(Boolean).length).toBeLessThanOrEqual(3);
  });

  it("regenerates once when the first draft repeats a recent assistant reply", async () => {
    completionCreate
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Large gives the best overall balance for most buyers." } }],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                "Large is the best fit for most buyers, and Jumbo is better if you're buying for gifting.",
            },
          },
        ],
      });

    const reply = await generateSmartReply({
      history: [{ role: "assistant", content: "Large gives the best overall balance for most buyers." }],
      latestUserMessage: "which is best?",
      recentAssistantReplies: ["Large gives the best overall balance for most buyers."],
    });

    expect(completionCreate).toHaveBeenCalledTimes(2);
    expect(reply).toBe(
      "Large is the best fit for most buyers, and Jumbo is better if you're buying for gifting."
    );

    const retryRequest = completionCreate.mock.calls[1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(
      retryRequest.messages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("Do not repeat. Answer the latest customer message in a fresh, natural way.")
      )
    ).toBe(true);
  });

  it("uses the safe fallback when AI generation fails", async () => {
    completionCreate.mockRejectedValueOnce(new Error("Provider unavailable"));

    const reply = await generateSmartReply({
      history: [],
      latestUserMessage: "price?",
      recentAssistantReplies: [],
    });

    expect(reply).toBe(SAFE_FALLBACK_REPLY);
  });

  it("flags highly similar assistant replies as repeats", () => {
    const recentReplies = [
      "Large gives the best overall balance for most buyers.",
      "Happy to help with mangoes or delivery.",
    ];

    expect(
      isRepeating(
        "Large gives the best overall balance for most buyers.",
        recentReplies
      )
    ).toBe(true);
    expect(
      isRepeating(
        "Large is the best overall balance for most buyers.",
        recentReplies
      )
    ).toBe(true);
    expect(
      isRepeating(
        "Jumbo is usually best if you're buying for gifting.",
        recentReplies
      )
    ).toBe(false);
  });
});
