import "server-only";

import OpenAI from "openai";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

let hasLoggedAIConfig = false;

function getAIConfig() {
  const openRouterApiKey = process.env.OPENROUTER_API_KEY;
  const openAIApiKey = process.env.OPENAI_API_KEY;
  const provider = openRouterApiKey ? "openrouter" : openAIApiKey ? "openai" : "none";
  const requestedModel = process.env.AI_MODEL?.trim() || null;
  const model = resolveModel(provider, requestedModel);

  if (!hasLoggedAIConfig) {
    console.log("[WH-INFO] AI config loaded", {
      provider,
      model,
      hasOpenRouterKey: !!openRouterApiKey,
      hasOpenAIKey: !!openAIApiKey,
    });
    hasLoggedAIConfig = true;
  }

  return { openRouterApiKey, openAIApiKey, provider, model };
}

function resolveModel(
  provider: "openrouter" | "openai" | "none",
  requestedModel: string | null
) {
  if (provider === "openai") {
    const model = requestedModel || "gpt-4o-mini";
    return model.startsWith("openai/") ? model.replace(/^openai\//, "") : model;
  }

  if (provider === "openrouter") {
    if (!requestedModel || requestedModel === "gpt-4o-mini") {
      return "openai/gpt-4o-mini";
    }

    return requestedModel;
  }

  return requestedModel || "openai/gpt-4o-mini";
}

function getOpenAIClient() {
  const { openRouterApiKey, openAIApiKey, provider } = getAIConfig();

  if (provider === "none") {
    throw new Error("Missing AI credentials. Set OPENROUTER_API_KEY or OPENAI_API_KEY.");
  }

  if (provider === "openrouter") {
    return new OpenAI({
      apiKey: openRouterApiKey,
      baseURL: "https://openrouter.ai/api/v1",
    });
  }

  return new OpenAI({
    apiKey: openAIApiKey,
  });
}

export async function getAIResponse(
  messages: { role: "user" | "assistant"; content: string }[]
) {
  const openai = getOpenAIClient();
  const { model } = getAIConfig();

  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...messages,
    ],
  });

  return completion.choices[0]?.message?.content || "Sorry, I couldn't generate a response.";
}
