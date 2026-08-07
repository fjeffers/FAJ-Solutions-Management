import { createClient } from '@/lib/supabase/server';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { upsertVendorFromW9 } from '@/lib/quickbooks';
import { NextResponse } from 'next/server';

// Body: { contractorId } — pushes a filed W-9 into QuickBooks as a 1099 vendor.
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { contractorId } = await req.json();
  if (!contractorId) return NextResponse.json({ error: 'Missing contractorId' }, { status: 400 });

  const { data: contractor } = await supabase
    .from('contractors').select('*').eq('id', contractorId).eq('user_id', user.id).single();
  if (!contractor) return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });

  if (!contractor.w9_received) {
    return NextResponse.json({ error: 'No W-9 on file for this contractor yet' }, { status: 400 });
  }

  const session = await getValidQboSession(user.id);
  if (!session) return NextResponse.json({ error: 'QuickBooks not connected' }, { status: 400 });

  try {
    const vendorId = await upsertVendorFromW9(session.environment, session.realm_id, session.access_token, {
      displayName: contractor.business_name || contractor.name,
      legalName: contractor.business_name ? contractor.name : null,
      email: contractor.email,
      phone: contractor.phone,
      taxId: contractor.tax_id,
      address: contractor.address,
      city: contractor.city,
      state: contractor.state,
      zip: contractor.zip,
    });

    await supabase.from('contractors').update({ qbo_vendor_id: vendorId }).eq('id', contractorId);

    return NextResponse.json({ ok: true, message: `${contractor.name} synced to QuickBooks`, vendorId });
  } catch (err) {
    console.error('QuickBooks contractor sync error:', err);
    return NextResponse.json({ error: 'Failed to sync to QuickBooks' }, { status: 500 });
  }
}
