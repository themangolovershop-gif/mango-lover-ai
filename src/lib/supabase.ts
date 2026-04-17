import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _supabase: SupabaseClient | null = null;
let hasLoggedSupabaseConfig = false;

export function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!hasLoggedSupabaseConfig) {
      console.log("[WH-INFO] Supabase config loaded", {
        hasUrl: !!url,
        urlHost: url ? new URL(url).host : null,
        hasServiceRoleKey: !!serviceRoleKey,
      });
      hasLoggedSupabaseConfig = true;
    }

    if (!url || !serviceRoleKey) {
      throw new Error(
        "Missing Supabase server credentials. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      );
    }

    _supabase = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    const client = getSupabase() as unknown as Record<PropertyKey, unknown>;
    const value = client[prop];

    return typeof value === "function" ? value.bind(getSupabase()) : value;
  },
});
