// Supabase is optional during local development. Without these env vars the app
// runs in "local mode": no sign-in, and the graph is kept in the browser.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
