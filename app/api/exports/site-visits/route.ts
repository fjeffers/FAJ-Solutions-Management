import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'excel'; // 'excel' or 'sheets'
  const customerId = searchParams.get('customerId');

  try {
    // Fetch site visits
    let query = supabase
      .from('site_visits')
      .select(
        `
        id,
        visit_date,
        site_code,
        address,
        site_name,
        hours,
        rate,
        total_project_price,
        visit_type,
        invoice_status,
        payment_status,
        miles,
        travel_charge,
        notes,
        contractor_id,
        contractors(name)
      `
      )
      .eq('user_id', user.id)
      .order('visit_date', { ascending: false });

    if (customerId) {
      query = query.eq('customer_id', customerId);
    }

    const { data: visits, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Transform data for spreadsheet
    const sheetData = visits.map((v: any) => ({
      'Site ID/Date': v.visit_date,
      'Address': v.address,
      'Site Name': v.site_name,
      'Rate': v.rate,
      'Total Hours': v.hours,
      'Project or T&M': v.visit_type,
      'Invoice Status': v.invoice_status === 'invoiced' ? 'Invoiced' : 'Not Invoiced',
      'Payment Status': v.payment_status === 'paid' ? 'Paid' : 'Unpaid',
      'Round Trip': '', // placeholder
      'Mile': v.miles || '',
      'Travel Charge': v.travel_charge || '',
      'Contractor': v.contractors?.name || '',
      'Project Price': v.total_project_price || '',
      'Notes': v.notes || '',
    }));

    if (format === 'excel') {
      // Generate Excel file
      const ws = XLSX.utils.json_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Site Visits');

      // Set column widths
      ws['!cols'] = [
        { wch: 12 }, // Site ID/Date
        { wch: 30 }, // Address
        { wch: 15 }, // Site Name
        { wch: 12 }, // Rate
        { wch: 12 }, // Total Hours
        { wch: 15 }, // Project or T&M
        { wch: 15 }, // Invoice Status
        { wch: 15 }, // Payment Status
        { wch: 12 }, // Round Trip
        { wch: 8 },  // Mile
        { wch: 15 }, // Travel Charge
        { wch: 15 }, // Contractor
        { wch: 15 }, // Project Price
        { wch: 30 }, // Notes
      ];

      const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

      return new NextResponse(buffer, {
        headers: {
          'Content-Disposition': 'attachment; filename="site-visits.xlsx"',
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });
    } else if (format === 'sheets') {
      // Return data for Google Sheets import
      return NextResponse.json({
        data: sheetData,
        title: 'Site Visits Export',
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  } catch (err) {
    console.error('Export error:', err);
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
