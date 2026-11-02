import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';

// Body: { expense_account_id, expense_account_name, payment_account_id, payment_account_name }
export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const body = await req.json();
  const { expense_account_id, expense_account_name, payment_account_id, payment_account_name } = body;
  if (!expense_account_id || !payment_account_id) {
    return NextResponse.json({ error: 'Both accounts are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.from('quickbooks_connections').update({
    default_expense_account_id: expense_account_id,
    default_expense_account_name: expense_account_name,
    default_payment_account_id: payment_account_id,
    default_payment_account_name: payment_account_name,
  }).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
