import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createQBVendor } from '@/lib/quickbooks';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { contractorId } = await req.json();

  if (!contractorId) {
    return NextResponse.json({ error: 'Contractor ID required' }, { status: 400 });
  }

  try {
    // Get contractor details
    const { data: contractor, error: fetchErr } = await supabase
      .from('contractors')
      .select('*')
      .eq('id', contractorId)
      .eq('user_id', user.id)
      .single();

    if (fetchErr || !contractor) {
      return NextResponse.json({ error: 'Contractor not found' }, { status: 404 });
    }

    // Get user's QB credentials from settings
    const { data: settings, error: settingsErr } = await supabase
      .from('user_settings')
      .select('qbo_access_token, qbo_realm_id')
      .eq('user_id', user.id)
      .single();

    if (settingsErr || !settings?.qbo_access_token || !settings?.qbo_realm_id) {
      return NextResponse.json(
        { error: 'QuickBooks not connected. Please authorize first.' },
        { status: 400 }
      );
    }

    // Build vendor payload
    const vendorPayload = {
      DisplayName: contractor.business_name || contractor.name,
      PrimaryEmailAddr: contractor.email ? { Address: contractor.email } : undefined,
      PrimaryPhone: contractor.phone ? { FreeFormNumber: contractor.phone } : undefined,
      BillAddr: {
        Line1: contractor.address || '',
        City: contractor.city || '',
        CountrySubDivisionCode: contractor.state || '',
        PostalCode: contractor.zip || '',
      },
      TaxID: contractor.tax_id || '',
    };

    // Create vendor in QB
    const qbVendor = await createQBVendor(
      settings.qbo_access_token,
      settings.qbo_realm_id,
      vendorPayload
    );

    // Store QB vendor ID
    const { error: updateErr } = await supabase
      .from('contractors')
      .update({
        qbo_vendor_id: qbVendor.Vendor.Id,
      })
      .eq('id', contractorId);

    if (updateErr) throw updateErr;

    return NextResponse.json({
      ok: true,
      message: `Contractor synced to QuickBooks as vendor ${qbVendor.Vendor.DisplayName}`,
      qboVendorId: qbVendor.Vendor.Id,
    });
  } catch (err: any) {
    console.error('QB sync error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to sync to QuickBooks' },
      { status: 500 }
    );
  }
}
