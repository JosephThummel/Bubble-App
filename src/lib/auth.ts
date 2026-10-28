import { supabaseEnabled } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

// API routes spend the Anthropic key, so they only serve signed-in users.
// Local mode (no Supabase) is allowed in development, or in production only
// when ALLOW_LOCAL_MODE=true is set explicitly.
export async function requireUser(): Promise<{ ok: true } | { ok: false; response: Response }> {
  if (!supabaseEnabled) {
    if (process.env.NODE_ENV !== "production" || process.env.ALLOW_LOCAL_MODE === "true") return { ok: true };
    return { ok: false, response: Response.json({ error: "Sign-in is not configured" }, { status: 503 }) };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: Response.json({ error: "Not signed in" }, { status: 401 }) };
  return { ok: true };
}
