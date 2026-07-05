import { createClient } from '@/lib/supabase/server';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { listAccounts } from '@/lib/quickbooks';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const session = await getValidQboSession(user.id);
  if (!session) return NextResponse.json({ error: 'Not connected' }, { status: 404 });

  try {
    const accounts = await listAccounts(session.environment, session.realm_id, session.access_token);
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error('QuickBooks accounts fetch error:', err);
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}
