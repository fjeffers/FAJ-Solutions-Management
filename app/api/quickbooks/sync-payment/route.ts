import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { findOrCreateVendor, createExpensePurchase } from '@/lib/quickbooks';
import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';

// Body: { payment_id }
export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const { payment_id } = await req.json();
  if (!payment_id) return NextResponse.json({ error: 'Missing payment_id' }, { status: 400 });

  const { data: payment } = await supabase.from('payments').select('*').eq('id', payment_id).eq('user_id', user.id).single();
  if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (payment.qbo_synced_at) return NextResponse.json({ error: 'Already synced' }, { status: 400 });

  const session = await getValidQboSession(user.id);
  if (!session) return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });
  if (!session.default_expense_account_id || !session.default_payment_account_id) {
    return NextResponse.json({ error: 'Set your expense and payment account mapping first' }, { status: 400 });
  }

  const { data: contractor } = await supabase.from('contractors').select('*').eq('name', payment.contractor_name).eq('user_id', user.id).maybeSingle();

  try {
    const admin = createAdminClient();

    let vendorId = contractor?.qbo_vendor_id ?? null;
    if (!vendorId) {
      vendorId = await findOrCreateVendor(session.environment, session.realm_id, session.access_token, payment.contractor_name);
      if (contractor) await admin.from('contractors').update({ qbo_vendor_id: vendorId }).eq('id', contractor.id);
    }

    const transactionId = await createExpensePurchase(session.environment, session.realm_id, session.access_token, {
      vendorId,
      amount: Number(payment.amount),
      date: payment.payment_date,
      paymentAccountId: session.default_payment_account_id,
      expenseAccountId: session.default_expense_account_id,
      memo: `WO#${payment.wo_number}`,
    });

    await admin.from('payments').update({
      qbo_synced_at: new Date().toISOString(),
      qbo_transaction_id: transactionId,
    }).eq('id', payment_id);

    return NextResponse.json({ ok: true, transaction_id: transactionId });
  } catch (err) {
    console.error('QuickBooks sync error:', err);
    const message = err instanceof Error ? err.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
