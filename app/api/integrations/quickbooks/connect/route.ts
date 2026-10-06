import { createClient } from '@/lib/supabase/server';
import { getQuickBooksAuthUrl } from '@/lib/quickbooks';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Without these the redirect still happens, but with client_id=undefined —
  // Intuit answers with its own error page, which says nothing about the real
  // cause. Fail here with the fix instead.
  const missing = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'NEXT_PUBLIC_APP_URL']
    .filter((k) => !process.env[k]);
  if (missing.length > 0) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
    return NextResponse.json({
      error: `QuickBooks isn't configured yet. Missing in this environment: ${missing.join(', ')}.`,
      fix: 'Add them in Vercel → Project → Settings → Environment Variables, then redeploy.',
      redirect_uri_to_register: base ? `${base}/api/integrations/quickbooks/callback` : '(set NEXT_PUBLIC_APP_URL first)',
    }, { status: 503 });
  }

  return NextResponse.redirect(getQuickBooksAuthUrl(user.id));
}
