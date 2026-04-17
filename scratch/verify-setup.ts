import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

async function verifyKeys() {
  console.log("🔍 Starting Production Key Verification...\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const openRouterKey = process.env.OPENROUTER_API_KEY || "";
  const aiModel = process.env.AI_MODEL || "openai/gpt-4o-mini";

  // 1. Verify Supabase
  console.log("📡 Checking Supabase connection...");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("❌ ERROR: Missing Supabase URL or Service Role Key in .env.local\n");
  } else {
    try {
      const supabase = createClient(supabaseUrl, serviceRoleKey);
      const { data, error } = await supabase.from("conversations").select("id").limit(1);
      
      if (error) {
        console.error("❌ SUPABASE ERROR:", error.message);
        if (error.message.includes("Invalid API key") || error.code === "PGRST301") {
          console.error("   🚨 YOUR SERVICE_ROLE_KEY IS INVALID! Please re-copy it from Supabase settings.\n");
        }
      } else {
        console.log("✅ Supabase: Connected Successfully!\n");
      }
    } catch (e) {
      console.error("❌ SUPABASE CRITICAL ERROR:", e);
    }
  }

  // 2. Verify OpenRouter
  console.log("🤖 Checking OpenRouter AI connection...");
  if (!openRouterKey) {
    console.error("❌ ERROR: Missing OPENROUTER_API_KEY in .env.local\n");
  } else {
    try {
      const openai = new OpenAI({
        apiKey: openRouterKey,
        baseURL: "https://openrouter.ai/api/v1",
      });

      const response = await openai.chat.completions.create({
        model: aiModel,
        messages: [{ role: "user", content: "hi" }],
        max_tokens: 5,
      });

      if (response.choices && response.choices.length > 0) {
        console.log("✅ OpenRouter: Connected Successfully! AI responded.");
        console.log(`   Model used: ${aiModel}\n`);
      } else {
        console.error("❌ OPENROUTER ERROR: Received empty response from AI\n");
      }
    } catch (e: any) {
      console.error("❌ OPENROUTER ERROR:", e?.message || e);
      if (e?.message?.includes("Invalid API key") || e?.status === 401) {
        console.error("   🚨 YOUR OPENROUTER_API_KEY IS INVALID!\n");
      }
    }
  }

  console.log("📜 Summary:");
  console.log("- SUPABASE_URL:", supabaseUrl ? "OK" : "MISSING");
  console.log("- SUPABASE_KEY:", serviceRoleKey ? `PROXIED (${serviceRoleKey.substring(0, 10)}...)` : "MISSING");
  console.log("- OPENROUTER_KEY:", openRouterKey ? `PROXIED (${openRouterKey.substring(0, 10)}...)` : "MISSING");
}

verifyKeys().catch(console.error);
