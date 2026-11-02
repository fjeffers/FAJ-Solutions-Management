import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { findOrCreateCustomer, findOrCreateServiceItem, createInvoice } from '@/lib/quickbooks';
import { buildQbInvoice, rejectedVisits, coveredVisitIds, qbInvoiceTotal } from '@/lib/qb-invoice';
import { NextResponse } from 'next/server';
import type { SiteVisit } from '@/lib/types';
import { ownerOnly } from '@/lib/security';

// Raise an invoice for a set of site visits — IN QUICKBOOKS.
//
// Body: { customer_name, visit_ids: string[], due_date?, memo?, dry_run? }
//
// The app no longer keeps its own invoice numbers. It says "these visits, this
// customer"; QuickBooks issues the document and owns the number, and that
// number is written straight back onto the visits so the two can never drift.
//
// dry_run returns exactly what WOULD be sent, so Fred can read the lines and
// the total before a real document exists in his ledger.

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const { customer_name, visit_ids, due_date, memo, dry_run } = body as {
    customer_name?: string; visit_ids?: string[]; due_date?: string; memo?: string; dry_run?: boolean;
  };

  if (!customer_name?.trim()) return NextResponse.json({ error: 'Which customer is this for?' }, { status: 400 });
  if (!Array.isArray(visit_ids) || visit_ids.length === 0) {
    return NextResponse.json({ error: 'Pick at least one visit to bill.' }, { status: 400 });
  }

  // Read the visits from the database, never from the request. A client that
  // could post its own amounts could bill any figure it liked.
  const { data: visits, error } = await supabase
    .from('site_visits').select('*').in('id', visit_ids).eq('user_id', user.id);
  if (error)   return NextResponse.json({ error: `Couldn't load those visits: ${error.message}` }, { status: 500 });
  if (!visits || visits.length === 0) return NextResponse.json({ error: 'None of those visits were found.' }, { status: 404 });

  const rows = visits as SiteVisit[];
  const skipped = rejectedVisits(rows);
  const covered = coveredVisitIds(rows);

  const session = await getValidQboSession(user.id);
  if (!session && !dry_run) {
    return NextResponse.json({
      error: 'QuickBooks is not connected yet.',
      fix: 'Open Settings → QuickBooks and connect the company, then try again.',
    }, { status: 400 });
  }

  // A dry run must never create anything, so it uses placeholder refs and
  // stops before any write.
  if (dry_run || !session) {
    try {
      const preview = buildQbInvoice(rows, { customerId: 'preview', itemId: 'preview', dueDate: due_date, memo });
      return NextResponse.json({
        dry_run: true,
        customer_name,
        lines: preview.Line.map((l) => ({ description: l.Description, qty: l.SalesItemLineDetail.Qty, rate: l.SalesItemLineDetail.UnitPrice, amount: l.Amount })),
        total: qbInvoiceTotal(preview),
        visit_count: covered.length,
        skipped,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message, skipped }, { status: 422 });
    }
  }

  try {
    const customerId = await findOrCreateCustomer(session.environment, session.realm_id, session.access_token, customer_name.trim());
    const itemId     = await findOrCreateServiceItem(session.environment, session.realm_id, session.access_token);

    const payload = buildQbInvoice(rows, { customerId, itemId, dueDate: due_date, memo });
    const invoice = await createInvoice(session.environment, session.realm_id, session.access_token, payload as unknown as Record<string, unknown>);

    // Write back only AFTER QuickBooks has accepted it. Marking first and
    // failing second would hide real work from the Needs Invoice list forever.
    const admin = createAdminClient();
    const { error: markErr } = await admin.from('site_visits')
      .update({
        invoice_status: 'invoiced',
        qbo_invoice_id: invoice.id,
        qbo_invoice_number: invoice.docNumber,
        updated_at: new Date().toISOString(),
      })
      .in('id', covered);

    return NextResponse.json({
      ok: true,
      invoice_id: invoice.id,
      invoice_number: invoice.docNumber,
      total: invoice.total,
      balance: invoice.balance,
      visits_marked: markErr ? 0 : covered.length,
      // Surfaced rather than swallowed: the invoice is real either way, and if
      // the write-back failed those visits would otherwise be billed twice.
      write_back_error: markErr ? markErr.message : null,
      skipped,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, skipped }, { status: 502 });
  }
}
