import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { createInvoice, findInvoiceByNumber, findOrCreateCustomer, findOrCreateServiceItem } from '@/lib/quickbooks';
import { JOB_LOG_QBO_ITEMS, jobLogMemo, jobLogQbPayload, parseInvoiceMeta, qbLinesTotal, type QbJobLine } from '@/lib/job-log-invoice';
import { lineAmount } from '@/lib/job-log-rates';
import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';

// The job log's invoice, made in QuickBooks (Fred, 2026-11-04: "i need to pase the invoice from INvoice to quick
// books invoice"). Body: { wo_id, lines, number, date, terms, bill_to, total }.
//
// The lines are the invoice as the office sees it on the job log (lib/job-log-invoice.ts quickBooksLines), edited
// there by the owner only, so they come from the screen; each must add up (qty × rate) and come to the total shown.
// The number is the one typed on the invoice: QuickBooks is asked first whether it has it, so it's never made twice.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// QuickBooks' longest invoice number.
const MAX_NUMBER = 21;
const MAX_LINES = 500;
const cents = (n: number) => Math.round(n * 100);

/** The lines sent, if each is a line QuickBooks can take and adds up; else null. */
function cleanLines(raw: unknown): QbJobLine[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_LINES) return null;
  const out: QbJobLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const l = r as Record<string, unknown>;
    const { date, item, description, qty, rate, amount } = l;
    if (typeof date !== 'string' || !DAY.test(date)) return null;
    if (typeof item !== 'string' || !JOB_LOG_QBO_ITEMS.includes(item)) return null;
    if (typeof description !== 'string') return null;
    if (![qty, rate, amount].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) return null;
    if ((qty as number) <= 0 || cents(amount as number) !== cents(lineAmount(qty as number, rate as number) ?? -1)) return null;
    out.push({ date, item, description: description.slice(0, 4000), qty: qty as number, rate: rate as number, amount: amount as number });
  }
  return out;
}

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const { wo_id, total } = body;
  if (!wo_id || typeof wo_id !== 'string') return NextResponse.json({ error: 'Which job is this for?' }, { status: 400 });
  const lines = cleanLines(body.lines);
  if (!lines) return NextResponse.json({ error: "The invoice's lines don't add up, so nothing was sent.", fix: 'Close the job log, open it again and try again.' }, { status: 400 });
  if (typeof total !== 'number' || cents(total) !== cents(qbLinesTotal(lines))) {
    return NextResponse.json({ error: "The invoice's total doesn't match its lines, so nothing was sent.", fix: 'Close the job log, open it again and try again.' }, { status: 400 });
  }
  const number = typeof body.number === 'string' ? body.number.trim() : '';
  if (number.length > MAX_NUMBER) {
    return NextResponse.json({ error: `QuickBooks takes invoice numbers up to ${MAX_NUMBER} letters and digits.`, fix: 'Edit invoice and type a shorter number.' }, { status: 400 });
  }
  const date = typeof body.date === 'string' && DAY.test(body.date) ? body.date : null;
  if (!date) return NextResponse.json({ error: 'The invoice needs a date.', fix: 'Edit invoice and pick its date.' }, { status: 400 });
  const terms = typeof body.terms === 'number' && Number.isFinite(body.terms) && body.terms >= 0 && body.terms <= 365 ? Math.round(body.terms) : 30;

  const { data: wo } = await supabase.from('work_orders')
    .select('id, wo_number, external_wo_id, site_name, title, customer_name')
    .eq('id', wo_id).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: 'That work order was not found.' }, { status: 404 });
  const customer = ((typeof body.bill_to === 'string' ? body.bill_to : '').trim() || wo.customer_name || '').trim().slice(0, 100);
  if (!customer) return NextResponse.json({ error: 'Who is the invoice billed to?', fix: 'Edit invoice and type the Bill to.' }, { status: 400 });

  const { data: kept, error: readErr } = await supabase.from('job_log_rates').select('invoice').eq('wo_id', wo.id).maybeSingle();
  const meta = parseInvoiceMeta((kept as { invoice?: unknown } | null)?.invoice, date);
  const session = await getValidQboSession(user.id);
  if (!session) {
    return NextResponse.json({
      error: 'QuickBooks is not connected, or its sign-in expired.', fix: 'Connect it again in Settings → QuickBooks, or use the QuickBooks import file button.', not_connected: true,
    }, { status: 409 });
  }
  // Older records were created while FAJ only had a Sandbox connection and did
  // not store the environment. They must not block the first real invoice after
  // the company switches to Production.
  const sameCompany = meta.qbo?.environment
    ? meta.qbo.environment === session.environment && (!meta.qbo.realmId || meta.qbo.realmId === session.realm_id)
    : session.environment === 'sandbox';
  if (meta.qbo?.id && sameCompany) {
    return NextResponse.json({
      error: `This invoice already exists in QuickBooks as ${meta.qbo.number || 'an invoice'}.`,
      fix: 'Open the existing invoice in QuickBooks. FAJ stopped this retry so it would not create a duplicate.',
      existing: meta.qbo,
    }, { status: 409 });
  }

  try {
    const { environment: env, realm_id: realm, access_token: token } = session;
    if (number) {
      const had = await findInvoiceByNumber(env, realm, token, number);
      if (had) {
        return NextResponse.json({
          error: `QuickBooks already has invoice ${had.docNumber} ($${had.total.toFixed(2)}).`, fix: 'Open it in QuickBooks, or type a new number on the invoice to make another.', existing: had,
        }, { status: 409 });
      }
    }
    const customerId = await findOrCreateCustomer(env, realm, token, customer);
    const itemIds: Record<string, string> = {};
    for (const name of new Set(lines.map((l) => l.item))) itemIds[name] = await findOrCreateServiceItem(env, realm, token, name);
    const memo = jobLogMemo(wo, lines);
    const note = `FAJ Solutions job log invoice, WO ${wo.wo_number}.`;
    const payload = jobLogQbPayload(lines, { customerId, itemIds, number: number || undefined, date, terms, memo, note });
    // The same invoice sent again (a double tap, a retry) is the same request to QuickBooks, which makes it once.
    const requestId = createHash('sha256').update(JSON.stringify([wo.id, payload])).digest('hex').slice(0, 40);
    const invoice = await createInvoice(env, realm, token, payload as unknown as Record<string, unknown>, requestId);
    const sent = {
      id: invoice.id,
      number: invoice.docNumber || number,
      total: invoice.total,
      at: new Date().toISOString(),
      environment: env,
      realmId: realm,
    };

    // Kept with the invoice's boxes, so the job log says it's in QuickBooks.
    let writeBackError: string | null = readErr?.message ?? null;
    if (!readErr) {
      const { error } = await supabase.from('job_log_rates').update({ invoice: { ...meta, qbo: sent } }).eq('wo_id', wo.id);
      writeBackError = error?.message ?? null;
    }
    return NextResponse.json({ ok: true, sent, invoice_id: invoice.id, invoice_number: sent.number, total: invoice.total, write_back_error: writeBackError });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
