import { createClient as createSupabaseClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS entirely. Server-only, never import this from a
// client component or expose SUPABASE_SERVICE_ROLE_KEY outside server routes.
// Used only by: gmail OAuth callback, the email-import cron route, and their
// QuickBooks-sync equivalents (Phase 11) — every other part of this app runs on the
// anon key + RLS. See Phase 9's plan notes for why this was introduced.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}
