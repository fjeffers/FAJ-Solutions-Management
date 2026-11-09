import { createClient } from '@/lib/supabase/server';
import { ownerOnly } from '@/lib/security';
import { loadQuickBooksReceivables } from '@/lib/quickbooks-receivables';
import { NextResponse } from 'next/server';

async function load() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  try {
    const invoices = await loadQuickBooksReceivables(user.id);
    return NextResponse.json({ ok: true, invoices, synced: invoices.length, at: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export const GET = load;
export const POST = load;
