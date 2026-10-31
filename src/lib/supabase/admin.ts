import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

// Service-role client for background jobs that act for every user (the news watch).
// Bypasses row-level security, so it is only ever used on the server.
export const adminEnabled = () => Boolean(SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export function createAdminClient() {
  return createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
