import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidQboSession } from '@/lib/quickbooks-session';
import { attachToInvoice, findOrCreateCustomer, findOrCreateServiceItem, createInvoice, sendInvoice } from '@/lib/quickbooks';
import { dayOf, parseDayEvents, type DayEvent } from '@/lib/project-day';
import {
  billRange, blocksBilling, byTech, fieldSheetInvoice, inDates, leadFirst, overlaps, parseEdits, parseSettings, qboItemFor, rowsFor, sheetTotals, withAccountRate, type SavedDay, type SheetReceipt,
} from '@/lib/field-sheet';
import type { OdoRow } from '@/lib/weekly-bill';
import { timesheetFile, timesheetLines, timesheetPdf } from '@/lib/timesheet';
import { sheetInvoiceNumber } from '@/lib/qbo-work-order-export';
import { NextResponse } from 'next/server';

// Bill one site's Field Sheet for a week — IN QUICKBOOKS, and email it to the client.
//
// Body: { wo_id, from?, to?, dry_run?, send?, photos?, timesheet? }
//    or { wo_id, from, to, imported: true, total, date }: a bill from the Field Sheet's
//       QuickBooks import file that QuickBooks has taken (see below).
//
// Fred, 2026-10-24: "when i finish it then save and uploaded into quickbooks
// the same way ... and sent off the client". The same way as the Site Log
// (create-invoice): the server rebuilds the sheet from the database, never from
// the request, so the amounts on the invoice are the sheet's own; QuickBooks
// issues the document and owns the number; dry_run shows the lines and total
// first. The same dates on the same site are never billed twice. With photos,
// the week's odometer, receipt and job photos are attached to the invoice and go
// in the client's email ("thats what the customer gets along with the pictures").
// With timesheet, the hours day by day go first as a PDF (lib/timesheet.ts):
// "so i can send it or attached to the quickbooks".

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
  const { wo_id, from: fromIn, to: toIn, dry_run, send, photos, timesheet, imported, total: importedTotal, date: importedDate } = body as {
    wo_id?: string; from?: string; to?: string; dry_run?: boolean; send?: boolean; photos?: boolean; timesheet?: boolean; imported?: boolean; total?: number; date?: string;
  };
  if (!wo_id || typeof wo_id !== 'string') return NextResponse.json({ error: 'Which job is this for?' }, { status: 400 });
  if ((fromIn && !DAY.test(fromIn)) || (toIn && !DAY.test(toIn))) return NextResponse.json({ error: 'Pick the dates again.' }, { status: 400 });
  if (fromIn && toIn && fromIn > toIn) return NextResponse.json({ error: 'The week starts after it ends. Pick the dates again.' }, { status: 400 });

  const { data: wo } = await supabase.from('work_orders')
    .select('id, wo_number, external_wo_id, site_name, title, site_address, site_city, site_state, site_zip, customer_name, contractor_name, contractor_names, lead_contractor_name, start_date, end_date')
    .eq('id', wo_id).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: 'That work order was not found.' }, { status: 404 });

  const [sheet, days, ev, punches, odo, ex, billed, jobPhotos, account] = await Promise.all([
    supabase.from('field_sheets').select('settings').eq('wo_id', wo.id).maybeSingle(),
    supabase.from('field_sheet_days').select('id, day, tech, edits, added, hidden').eq('wo_id', wo.id),
    supabase.from('job_day_events').select('id, contractor_name, kind, at, origin, dest, miles, miles_from_gps').eq('wo_id', wo.id).order('at'),
    supabase.from('job_punches').select('contractor_name, kind, at').eq('wo_id', wo.id).order('at'),
    supabase.from('job_odometer').select('wo_id, contractor_name, at, moment, reading, ai_reading, photo_path').eq('wo_id', wo.id).order('at'),
    supabase.from('job_expenses').select('id, contractor_name, category, vendor, amount, expense_date, status, receipt_path').eq('wo_id', wo.id),
    supabase.from('field_sheet_invoices').select('from_day, to_day, qbo_invoice_id, qbo_invoice_number').eq('wo_id', wo.id),
    supabase.from('wo_photos').select('url, taken_at').eq('wo_id', wo.id).order('taken_at'),
    supabase.from('user_settings').select('mileage_rate').maybeSingle(),
  ]);
  if (days.error || billed.error) {
    return NextResponse.json({ error: "The Field Sheet isn't set up in the database yet.", fix: 'Run migration 136 in Supabase, then try again.' }, { status: 500 });
  }
  // Every record the bill is built from, or nothing: a read that failed would leave its charges off and mark the dates billed.
  if ([sheet, ev, punches, odo, ex, jobPhotos, account].some((r) => r.error)) {
    return NextResponse.json({ error: "Couldn't read the whole sheet, so nothing was billed.", fix: 'Check your connection and try again.' }, { status: 503 });
  }

  // The same rate the screen shows: the sheet's own, else the account's.
  const s = withAccountRate(parseSettings(sheet.data?.settings), account.data?.mileage_rate);
  const events: DayEvent[] = parseDayEvents([...(ev.data ?? []), ...(punches.data ?? [])]);
  const readings = ((odo.data ?? []) as OdoRow[]).map((o) => ({ ...o, reading: Number(o.reading), ai_reading: o.ai_reading == null ? null : Number(o.ai_reading) }));
  const saved: SavedDay[] = (days.data ?? []).map((d) => ({ ...d, edits: parseEdits(d.edits) }));
  const techs = ((wo.contractor_names?.length ? wo.contractor_names : [wo.contractor_name]) as (string | null)[]).filter((t): t is string => !!t);
  const all = rowsFor({ events, readings, saved, techs, start: wo.start_date, end: wo.end_date, timeZone: TZ });
  const rows = all.filter((r) => inDates(r.day, fromIn, toIn));
  const receipts: SheetReceipt[] = ((ex.data ?? []) as { id: string; contractor_name: string | null; category: string; vendor: string | null; amount: number; expense_date: string; status: string }[])
    .filter((e) => inDates(e.expense_date, fromIn, toIn))
    .map((e) => ({ id: e.id, category: e.category, amount: Number(e.amount), status: e.status, vendor: e.vendor, date: e.expense_date, tech: e.contractor_name }));

  // The dates billed: those picked, else the first to the last thing on the bill (days and receipts).
  const range = billRange(rows, receipts, fromIn, toIn);
  const from = range?.from ?? (fromIn || wo.start_date || dayOf(new Date().toISOString(), TZ));
  const to = range?.to ?? (toIn || from);
  if (from > to) return NextResponse.json({ error: 'The week starts after it ends. Pick the dates again.' }, { status: 400 });
  const totals = sheetTotals(rows, receipts, s);
  const customer = (s.client || wo.customer_name || '').trim();
  if (!customer) return NextResponse.json({ error: 'Pick the client this is billed to.' }, { status: 400 });
  if (totals.lines.length === 0) {
    return NextResponse.json({ error: 'Nothing to bill for these dates yet.', fix: 'Set how the client is billed (rate, mileage, meals or hotel) above.' }, { status: 422 });
  }
  const alreadyBilled = (list: { from_day: string; to_day: string; qbo_invoice_id: string | null; qbo_invoice_number: string | null }[]) => {
    const b = list.find((x) => x.qbo_invoice_id && overlaps({ from, to }, { from: x.from_day, to: x.to_day }));
    return b ? NextResponse.json({
      error: `${fmt(b.from_day)} – ${fmt(b.to_day)} is already on QuickBooks invoice ${b.qbo_invoice_number ?? ''}.`.replace(' .', '.'),
      fix: 'Pick dates that are not billed yet.',
    }, { status: 409 }) : null;
  };
  const before = alreadyBilled(billed.data ?? []);
  if (before) return before;

  const site = s.site || [wo.site_name || wo.title, [wo.site_city, wo.site_state].filter(Boolean).join(', ')].filter(Boolean).join(' — ');
  const memo = `${site} · WO ${wo.wo_number}${wo.external_wo_id ? ` · Client # ${wo.external_wo_id}` : ''} · ${fmt(from)} – ${fmt(to)}`;
  const note = `FAJ Solutions Field Sheet, WO ${wo.wo_number}, ${from} to ${to}.`;
  const email = s.email.trim() || null;
  const preview = {
    customer, from, to, email, memo,
    lines: totals.lines.map((l) => ({ kind: l.kind, date: l.date, description: l.description, qty: l.qty, rate: l.rate, amount: l.amount })),
    total: totals.bill,
    // Each tech's hours, miles and materials, for the week's workbook (Fred, 2026-10-29: "I need a break down from each tech").
    perTech: byTech(rows, receipts, s, leadFirst(wo)), mileRate: s.mileRate,
  };

  // A bill from the QuickBooks import file, once Fred has imported it: recorded
  // as billed under the file's invoice number, so the same dates are never billed
  // again from here. Only on his word, never when the file is downloaded, and only
  // while the sheet still bills what the file has.
  if (imported) {
    if (!fromIn || !toIn || typeof importedTotal !== 'number' || Math.round(importedTotal * 100) !== Math.round(totals.bill * 100)) {
      return NextResponse.json({ error: 'The sheet has changed since the file was made, so it was not marked billed.', fix: 'Make the file again and import that one.' }, { status: 409 });
    }
    // The file's own invoice date, for NetView's form (migration 143).
    const invoiceDate = typeof importedDate === 'string' && DAY.test(importedDate) ? importedDate : dayOf(new Date().toISOString(), TZ);
    const admin = createAdminClient();
    const number = sheetInvoiceNumber(wo.wo_number, from);
    // The same hold as creating an invoice below: one in the making per site, so an invoice
    // being created in another tab and this can't both pass their checks for the same dates.
    // An import's hold carries the file's number from the start (an invoice's gets QuickBooks'
    // only once it exists), so this same bill, cut off before, carries on with its own hold.
    const { data: open, error: openErr } = await admin.from('field_sheet_invoices').select('id, from_day, to_day, created_at, qbo_invoice_number').eq('wo_id', wo.id).is('qbo_invoice_id', null);
    if (openErr) return NextResponse.json({ error: "Couldn't check what's billed, so nothing was marked.", fix: 'Try again.' }, { status: 503 });
    let holdId: string | null = null;
    // A hold this request made, and so may release; one it carries on with belongs to the press before.
    let made = false;
    for (const o of open ?? []) {
      if (o.qbo_invoice_number === number && o.from_day === from && o.to_day === to) { holdId = o.id; continue; }
      if (blocksBilling({ qbo_invoice_id: null, created_at: o.created_at })) {
        return NextResponse.json({ error: 'An invoice for this site is being created in QuickBooks right now.', fix: 'Refresh in a minute and check the Invoiced list.' }, { status: 409 });
      }
      if (overlaps({ from, to }, { from: o.from_day, to: o.to_day })) {
        return NextResponse.json({ error: 'An invoice for these dates was cut off before QuickBooks answered.', fix: 'Check QuickBooks for it first. If it is not there, create it again from the sheet.' }, { status: 409 });
      }
      await admin.from('field_sheet_invoices').delete().eq('id', o.id).is('qbo_invoice_id', null);
    }
    if (!holdId) {
      const { data: hold, error: holdErr } = await admin.from('field_sheet_invoices')
        .insert({ user_id: user.id, wo_id: wo.id, from_day: from, to_day: to, customer_name: customer, qbo_invoice_number: number }).select('id').single();
      if (holdErr || !hold) {
        return NextResponse.json(holdErr?.code === '23505'
          ? { error: 'An invoice for this site is being created in QuickBooks right now.', fix: 'Refresh in a minute and check the Invoiced list.' }
          : { error: "Couldn't mark it billed.", fix: 'Try again.' }, { status: holdErr?.code === '23505' ? 409 : 500 });
      }
      holdId = hold.id as string;
      made = true;
    }
    const held = holdId;
    const release = async () => { if (made) await admin.from('field_sheet_invoices').delete().eq('id', held).is('qbo_invoice_id', null); };
    // Now that this request holds the site, an invoice that finished a moment ago counts too.
    const { data: all, error: allErr } = await admin.from('field_sheet_invoices').select('from_day, to_day, qbo_invoice_id, qbo_invoice_number').eq('wo_id', wo.id);
    const clash = allErr ? NextResponse.json({ error: "Couldn't check what's billed, so nothing was marked.", fix: 'Try again.' }, { status: 503 }) : alreadyBilled(all ?? []);
    if (clash) { await release(); return clash; }
    // The hold becomes the record, once: only while it is still a hold. qbo_invoice_id marks the dates
    // billed everywhere; "import:" says QuickBooks gave it no id of its own here.
    const recordId = `import:${number}`;
    const { data: rec, error: recErr } = await admin.from('field_sheet_invoices')
      .update({ qbo_invoice_id: recordId, qbo_invoice_number: number, total: totals.bill, invoice_date: invoiceDate }).eq('id', held).is('qbo_invoice_id', null).select('id');
    if (recErr) { await release(); return NextResponse.json({ error: "Couldn't mark it billed.", fix: 'Try again.' }, { status: 500 }); }
    if (!rec?.length) {
      // Nothing changed: another press of Imported saved it a moment ago, or the hold is gone. Only the first is billed.
      const { data: now } = await admin.from('field_sheet_invoices').select('qbo_invoice_id').eq('id', held).maybeSingle();
      if (now?.qbo_invoice_id !== recordId) return NextResponse.json({ error: "Couldn't mark it billed.", fix: 'Try again.' }, { status: 500 });
    }
    return NextResponse.json({ ok: true, imported: true, invoice_number: number, total: totals.bill });
  }

  // The bill alone needs no QuickBooks, so a connection that has lapsed never stops the import file.
  if (dry_run) return NextResponse.json({ dry_run: true, ...preview });
  const session = await getValidQboSession(user.id);
  if (!session) {
    return NextResponse.json({
      dry_run: true, ...preview, warning: 'QuickBooks is not connected yet. Open Settings → QuickBooks and connect the company to create it.',
    });
  }

  // Hold the site BEFORE QuickBooks is called: one invoice in the making per site
  // (field_sheet_invoices_one_in_progress), so two clicks or two tabs can't bill the
  // same dates twice. The hold's id is QuickBooks' requestid, so a request that died
  // after QuickBooks took it is retried as the same invoice, not a second one.
  const admin = createAdminClient();
  const { data: open } = await admin.from('field_sheet_invoices').select('id, from_day, to_day, created_at, qbo_invoice_number').eq('wo_id', wo.id).is('qbo_invoice_id', null);
  let holdId: string | null = null;
  for (const o of open ?? []) {
    if (blocksBilling({ qbo_invoice_id: null, created_at: o.created_at })) continue;
    // Marking these dates imported from the file was cut off: they're already in QuickBooks.
    if (o.qbo_invoice_number && overlaps({ from, to }, { from: o.from_day, to: o.to_day })) {
      return NextResponse.json({
        error: `${fmt(o.from_day)} – ${fmt(o.to_day)} was being marked imported as ${o.qbo_invoice_number} from the QuickBooks import file.`,
        fix: 'Make the file again and press Imported on it, so it is not billed twice.',
      }, { status: 409 });
    }
    if (o.from_day === from && o.to_day === to) holdId = o.id;
    else await admin.from('field_sheet_invoices').delete().eq('id', o.id).is('qbo_invoice_id', null);
  }
  if (!holdId) {
    const { data: hold, error: holdErr } = await admin.from('field_sheet_invoices')
      .insert({ user_id: user.id, wo_id: wo.id, from_day: from, to_day: to, customer_name: customer }).select('id').single();
    if (holdErr || !hold) {
      return NextResponse.json(holdErr?.code === '23505'
        ? { error: 'An invoice for this site is being created right now.', fix: 'Wait a minute, refresh, and check the Invoiced list.' }
        : { error: "Couldn't start the invoice.", fix: 'Check your connection and try again.' }, { status: holdErr?.code === '23505' ? 409 : 500 });
    }
    holdId = hold.id as string;
  }
  if (!holdId) return NextResponse.json({ error: "Couldn't start the invoice." }, { status: 500 });
  const held = holdId;
  const release = () => admin.from('field_sheet_invoices').delete().eq('id', held).is('qbo_invoice_id', null);
  // Now that this request holds the site, an invoice that finished a moment ago counts too.
  const { data: done, error: doneErr } = await admin.from('field_sheet_invoices').select('from_day, to_day, qbo_invoice_id, qbo_invoice_number').eq('wo_id', wo.id);
  const clash = doneErr ? NextResponse.json({ error: "Couldn't check what's billed, so nothing was billed.", fix: 'Try again.' }, { status: 503 }) : alreadyBilled(done ?? []);
  if (clash) { await release(); return clash; }

  try {
    let invoice: Awaited<ReturnType<typeof createInvoice>>;
    try {
      const customerId = await findOrCreateCustomer(session.environment, session.realm_id, session.access_token, customer);
      // Each line on its own Product/service: Cabling, Traveling, Meals, Lodging.
      const itemIds: Record<string, string> = {};
      for (const name of new Set(totals.lines.map((l) => qboItemFor(l.kind)))) {
        itemIds[name] = await findOrCreateServiceItem(session.environment, session.realm_id, session.access_token, name);
      }
      const payload = fieldSheetInvoice(totals.lines, { customerId, itemIds, memo, note, email, txnDate: dayOf(new Date().toISOString(), TZ) });
      invoice = await createInvoice(session.environment, session.realm_id, session.access_token, payload as unknown as Record<string, unknown>, held);
    } catch (e) {
      await release();
      throw e;
    }

    // The hold becomes the record, the same row, once QuickBooks has accepted it.
    const { data: rec, error: recErr } = await admin.from('field_sheet_invoices')
      .update({ customer_name: customer, qbo_invoice_id: invoice.id, qbo_invoice_number: invoice.docNumber, total: invoice.total })
      .eq('id', held).select('id').single();

    // The timesheet, then the photos, attached before the email goes so they go with it.
    let timesheetAttached = false;
    let timesheetError: string | null = null;
    if (timesheet) {
      try {
        const head = {
          woNumber: wo.wo_number, clientWo: wo.external_wo_id, site: s.site || wo.site_name || wo.title || '', client: customer, from, to,
          address: [wo.site_address, [wo.site_city, [wo.site_state, wo.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', '),
        };
        const pdf = await timesheetPdf(head, timesheetLines(rows));
        await attachToInvoice(session.environment, session.realm_id, session.access_token, invoice.id,
          { name: timesheetFile(head, 'pdf').replace(/\s+/g, '-'), type: 'application/pdf', bytes: pdf.slice().buffer });
        timesheetAttached = true;
      } catch {
        timesheetError = "The timesheet couldn't go with the invoice. Download it from the work order and add it in QuickBooks.";
      }
    }
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
      timesheet_attached: timesheetAttached, timesheet_error: timesheetError,
      // Surfaced rather than swallowed: the invoice is real either way, and without the record these dates could be billed again.
      write_back_error: recErr ? recErr.message : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
