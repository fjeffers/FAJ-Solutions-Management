import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { attachToInvoice, findOrCreateCustomer, findOrCreateServiceItem, createInvoice, sendInvoice } from '@/lib/quickbooks';
import { dayOf, parseDayEvents, type DayEvent } from '@/lib/project-day';
import {
  fieldSheetInvoice, inDates, overlaps, parseEdits, parseSettings, rowsFor, sheetTotals, type SavedDay, type SheetReceipt,
} from '@/lib/field-sheet';
import type { OdoRow } from '@/lib/weekly-bill';
import { NextResponse } from 'next/server';

// Bill one site's Field Sheet for a week — IN QUICKBOOKS, and email it to the client.
//
// Body: { wo_id, from?, to?, dry_run?, send?, photos? }
//
// Fred, 2026-10-24: "when i finish it then save and uploaded into quickbooks
// the same way ... and sent off the client". The same way as the Site Log
// (create-invoice): the server rebuilds the sheet from the database, never from
// the request, so the amounts on the invoice are the sheet's own; QuickBooks
// issues the document and owns the number; dry_run shows the lines and total
// first. The same dates on the same site are never billed twice. With photos,
// the week's odometer, receipt and job photos are attached to the invoice and go
// in the client's email ("thats what the customer gets along with the pictures").

const TZ = 'America/New_York';
const DAY = /^\d{4}-\d{2}-\d{2}$/;
// QuickBooks emails attachments with the invoice; keep the email a sensible size.
const MAX_PHOTOS = 40;
const MAX_PHOTO_BYTES = 18 * 1024 * 1024;

type PhotoFile = { label: string; path?: string; url?: string };
/** A file in this app's own Supabase storage. */
function ownStorage(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try { return !!base && new URL(url).origin === new URL(base).origin && new URL(url).pathname.startsWith('/storage/v1/'); } catch { return false; }
}
/** The photos to attach, receipts first (they back the bill), then the odometer, then the job. */
function photoList(p: { odometer: PhotoFile[]; receipts: PhotoFile[]; job: PhotoFile[] }): PhotoFile[] {
  return [...p.receipts, ...p.odometer, ...p.job];
}

const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { wo_id, from: fromIn, to: toIn, dry_run, send, photos } = body as { wo_id?: string; from?: string; to?: string; dry_run?: boolean; send?: boolean; photos?: boolean };
  if (!wo_id || typeof wo_id !== 'string') return NextResponse.json({ error: 'Which job is this for?' }, { status: 400 });
  if ((fromIn && !DAY.test(fromIn)) || (toIn && !DAY.test(toIn))) return NextResponse.json({ error: 'Pick the dates again.' }, { status: 400 });

  const { data: wo } = await supabase.from('work_orders')
    .select('id, wo_number, external_wo_id, site_name, title, site_address, site_city, site_state, site_zip, customer_name, contractor_name, contractor_names, start_date, end_date')
    .eq('id', wo_id).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: 'That work order was not found.' }, { status: 404 });

  const [sheet, days, ev, punches, odo, ex, billed, jobPhotos] = await Promise.all([
    supabase.from('field_sheets').select('settings').eq('wo_id', wo.id).maybeSingle(),
    supabase.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id),
    supabase.from('job_day_events').select('id, contractor_name, kind, at, origin, dest, miles').eq('wo_id', wo.id).order('at'),
    supabase.from('job_punches').select('contractor_name, kind, at').eq('wo_id', wo.id).order('at'),
    supabase.from('job_odometer').select('wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', wo.id).order('at'),
    supabase.from('job_expenses').select('id, category, vendor, amount, expense_date, status, receipt_path').eq('wo_id', wo.id),
    supabase.from('field_sheet_invoices').select('from_day, to_day, qbo_invoice_number').eq('wo_id', wo.id),
    supabase.from('wo_photos').select('url, taken_at').eq('wo_id', wo.id).order('taken_at'),
  ]);
  if (days.error || billed.error) {
    return NextResponse.json({ error: "The Field Sheet isn't set up in the database yet.", fix: 'Run migration 136 in Supabase, then try again.' }, { status: 500 });
  }

  const s = parseSettings(sheet.data?.settings);
  const events: DayEvent[] = parseDayEvents([...(ev.data ?? []), ...(punches.data ?? [])]);
  const readings = ((odo.data ?? []) as OdoRow[]).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
  const saved: SavedDay[] = (days.data ?? []).map((d) => ({ ...d, edits: parseEdits(d.edits) }));
  const techs = ((wo.contractor_names?.length ? wo.contractor_names : [wo.contractor_name]) as (string | null)[]).filter((t): t is string => !!t);
  const all = rowsFor({ events, readings, saved, techs, start: wo.start_date, end: wo.end_date, timeZone: TZ });
  const rows = all.filter((r) => inDates(r.day, fromIn, toIn));
  const receipts: SheetReceipt[] = ((ex.data ?? []) as { id: string; category: string; vendor: string | null; amount: number; expense_date: string; status: string }[])
    .filter((e) => inDates(e.expense_date, fromIn, toIn))
    .map((e) => ({ id: e.id, category: e.category, amount: Number(e.amount), status: e.status, vendor: e.vendor, date: e.expense_date }));

  // The dates billed: those picked, else the first to the last day on the sheet.
  const shown = rows.filter((r) => !r.hidden).map((r) => r.day).sort();
  const from = fromIn || shown[0] || wo.start_date || dayOf(new Date().toISOString(), TZ);
  const to = toIn || shown.at(-1) || from;
  const totals = sheetTotals(rows, receipts, s);
  const customer = (s.client || wo.customer_name || '').trim();
  if (!customer) return NextResponse.json({ error: 'Pick the client this is billed to.' }, { status: 400 });
  if (totals.lines.length === 0) {
    return NextResponse.json({ error: 'Nothing to bill for these dates yet.', fix: 'Set how the client is billed (rate, mileage, meals or hotel) above.' }, { status: 422 });
  }
  const before = (billed.data ?? []).find((b) => overlaps({ from, to }, { from: b.from_day, to: b.to_day }));
  if (before) {
    return NextResponse.json({
      error: `${fmt(before.from_day)} – ${fmt(before.to_day)} is already on QuickBooks invoice ${before.qbo_invoice_number ?? ''}.`.replace(' .', '.'),
      fix: 'Pick dates that are not billed yet.',
    }, { status: 409 });
  }

  const site = s.site || [wo.site_name || wo.title, [wo.site_city, wo.site_state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  const memo = `${site} · WO ${wo.wo_number}${wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''} · ${fmt(from)} – ${fmt(to)}`;
  const note = `FAJ Solutions Field Sheet, WO ${wo.wo_number}, ${from} to ${to}.`;
  const email = s.email.trim() || null;
  const preview = {
    customer, from, to, email, memo,
    lines: totals.lines.map((l) => ({ date: l.date, description: l.description, qty: l.qty, rate: l.rate, amount: l.amount })),
    total: totals.bill,
  };

  const session = await getValidQboSession(user.id);
  if (dry_run || !session) {
    return NextResponse.json({
      dry_run: true, ...preview,
      ...(session ? {} : { warning: 'QuickBooks is not connected yet. Open Settings → QuickBooks and connect the company to create it.' }),
    });
  }

  try {
    const customerId = await findOrCreateCustomer(session.environment, session.realm_id, session.access_token, customer);
    const itemId = await findOrCreateServiceItem(session.environment, session.realm_id, session.access_token);
    const payload = fieldSheetInvoice(totals.lines, { customerId, itemId, memo, note, email, txnDate: dayOf(new Date().toISOString(), TZ) });
    const invoice = await createInvoice(session.environment, session.realm_id, session.access_token, payload as unknown as Record<string, unknown>);

    // Recorded only AFTER QuickBooks accepted it, the same as the Site Log.
    const admin = createAdminClient();
    const { data: rec, error: recErr } = await admin.from('field_sheet_invoices').insert({
      user_id: user.id, wo_id: wo.id, from_day: from, to_day: to, customer_name: customer,
      qbo_invoice_id: invoice.id, qbo_invoice_number: invoice.docNumber, total: invoice.total,
    }).select('id').single();

    // The photos, attached before the email goes so they go with it.
    let attached = 0;
    let photoError: string | null = null;
    if (photos) {
      const files = photoList({
        odometer: ((odo.data ?? []) as OdoRow[]).filter((o) => o.photo_path && inDates(dayOf(o.at, TZ), from, to)).map((o) => ({ path: o.photo_path!, label: `odometer ${o.contractor_name} ${dayOf(o.at, TZ)}` })),
        receipts: ((ex.data ?? []) as { status: string; receipt_path: string | null; expense_date: string; category: string }[])
          .filter((e) => e.status === 'approved' && e.receipt_path && inDates(e.expense_date, from, to)).map((e) => ({ path: e.receipt_path!, label: `receipt ${e.category} ${e.expense_date}` })),
        // Only the app's own storage: a job photo's address is never fetched from anywhere else.
        job: ((jobPhotos.data ?? []) as { url: string; taken_at: string }[])
          .filter((p) => inDates(dayOf(p.taken_at, TZ), from, to) && ownStorage(p.url)).map((p) => ({ url: p.url, label: `job photo ${dayOf(p.taken_at, TZ)}` })),
      });
      let bytes = 0;
      const failed: string[] = [];
      for (const f of files) {
        if (attached >= MAX_PHOTOS || bytes >= MAX_PHOTO_BYTES) { failed.push(f.label); continue; }
        try {
          const blob = f.path
            ? (await admin.storage.from('job-receipts').download(f.path)).data
            : await fetch(f.url!).then((r) => (r.ok ? r.blob() : null));
          if (!blob || bytes + blob.size > MAX_PHOTO_BYTES) { failed.push(f.label); continue; }
          const type = blob.type || 'image/jpeg';
          const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : 'jpg';
          await attachToInvoice(session.environment, session.realm_id, session.access_token, invoice.id,
            { name: `${f.label.replace(/[^A-Za-z0-9 _-]+/g, '').replace(/\s+/g, '-')}.${ext}`, type, bytes: await blob.arrayBuffer() });
          bytes += blob.size;
          attached++;
        } catch {
          failed.push(f.label);
        }
      }
      if (failed.length) photoError = `${failed.length} photo${failed.length === 1 ? '' : 's'} couldn't go with the invoice (too many, too large, or not found). Add them in QuickBooks if the client needs them.`;
    }

    let sentTo: string | null = null;
    let sendError: string | null = null;
    if (send) {
      if (!email) sendError = 'No email for the client. Add it on the sheet and send it from QuickBooks.';
      else {
        try {
          sentTo = await sendInvoice(session.environment, session.realm_id, session.access_token, invoice.id, email);
          if (rec) await admin.from('field_sheet_invoices').update({ sent_to: sentTo, sent_at: new Date().toISOString() }).eq('id', rec.id);
        } catch (e) {
          sendError = (e as Error).message;
        }
      }
    }
    return NextResponse.json({
      ok: true, invoice_id: invoice.id, invoice_number: invoice.docNumber, total: invoice.total, balance: invoice.balance,
      sent_to: sentTo, send_error: sendError, photos_attached: attached, photo_error: photoError,
      // Surfaced rather than swallowed: the invoice is real either way, and without the record these dates could be billed again.
      write_back_error: recErr ? recErr.message : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
