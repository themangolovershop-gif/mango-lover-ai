import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStatus() {
  console.log("--- Latest 5 Conversations ---");
  const { data: convos } = await supabase
    .from("conversations")
    .select("phone, name, sales_state, lead_tag, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5);

  console.table(convos);

  if (convos && convos.length > 0) {
    const latestPhone = convos[0].phone;
    console.log(`\n--- Latest Messages for ${latestPhone} ---`);
    const { data: messages } = await supabase
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", (await supabase.from("conversations").select("id").eq("phone", latestPhone).single()).data?.id)
      .order("created_at", { ascending: false })
      .limit(10);

    console.table(messages);
  }

  console.log("\n--- Latest Orders ---");
  const { data: orders } = await supabase
    .from("orders")
    .select("phone, customer_name, product_size, quantity, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(5);

  console.table(orders);
}

checkStatus();
