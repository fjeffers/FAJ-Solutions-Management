import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  cleanScheduleRows, isCancelled, matchSchedule, newScheduleJob, planFill, siteKey, siteLookupIds, type ScheduleJob, type SchedulePreviewRow,
  SCHEDULE_MAX_ROWS, tooManyRows,
} from '@/lib/client-schedule';

// The client's weekly schedule (lib/client-schedule.ts). The browser reads the
// sheet and sends its rows here twice: first to see what each row would do,
// then with apply: true to do it. Matched jobs get their empty fields filled
// right away; rows with no job go into the import queue, and the Import screen
// approves them one by one into new jobs (the same path as every other import,
// so each gets its number and site visit the same way).

export const dynamic = 'force-dynamic';

const JOB_FIELDS = 'id, wo_number, title, wo_status, customer_name, source_platform, client_reference, external_wo_id, '
  + 'start_date, start_time, end_date, site_address, site_city, site_state, site_zip, access_instructions, client_links, '
  + 'checkin_link, checkout_link';

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (Array.isArray(body?.rows) && body.rows.length > SCHEDULE_MAX_ROWS) {
    return NextResponse.json({ error: tooManyRows(body.rows.length) }, { status: 400 });
  }
  const rows = cleanScheduleRows(body?.rows);
  if (rows.length === 0) return NextResponse.json({ error: 'No rows with a Site ID came through.' }, { status: 400 });

  const { data: jobs, error } = await supabase
    .from('work_orders')
    .select(JOB_FIELDS)
    .in('client_reference', siteLookupIds(rows))
    .is('archived_at', null);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list = (jobs ?? []) as unknown as ScheduleJob[];
  const matches = matchSchedule(rows, list);
  // A visit the client called off fills nothing; the preview flags its job.
  const plans = rows.map((r, i) => (matches[i] && !isCancelled(r) ? planFill(r, matches[i]!) : null));
  const preview: SchedulePreviewRow[] = rows.map((r, i) => ({
    line: r.line, siteId: r.siteId, ticket: r.ticket, date: r.date, time: r.time,
    cancelled: isCancelled(r),
    job: matches[i] ? { id: matches[i]!.id, wo_number: matches[i]!.wo_number, title: matches[i]!.title } : null,
    filled: plans[i]?.filled ?? [],
    differs: plans[i]?.differs ?? [],
  }));

  if (body?.apply !== true) return NextResponse.json({ rows: preview });

  // Fill the matched jobs. Each update is its own job, so one failure doesn't stop the rest.
  const failed: string[] = [];
  let filled = 0;
  const now = new Date().toISOString();
  await Promise.all(rows.map(async (_, i) => {
    const job = matches[i];
    const patch = plans[i]?.patch;
    if (!job || !patch || Object.keys(patch).length === 0) return;
    const { error: upErr } = await supabase.from('work_orders').update({ ...patch, updated_at: now }).eq('id', job.id);
    if (upErr) { console.error('schedule fill failed', job.wo_number, upErr.message); failed.push(job.wo_number); }
    else filled++;
  }));

  // Rows with no job (and not called off) wait in the queue as new jobs, named
  // and billed like the client's other jobs in this sheet.
  const like = matches.find(Boolean) ?? null;
  const fresh = rows.filter((r, i) => !matches[i] && !isCancelled(r));
  let queued: string[] = [];
  if (fresh.length > 0) {
    const { data: inserted, error: qErr } = await supabase
      .from('import_queue')
      .upsert(fresh.map((r) => ({
        user_id: user.id,
        source: 'client_schedule',
        external_dedupe_key: `${siteKey(r.siteId)}:${r.ticket || r.date || 'undated'}`,
        parsed_fields: newScheduleJob(r, like),
        // The lockbox code stays out of the preview text.
        raw_snippet: [`Site ${r.siteId}`, r.ticket, r.date, r.time, r.address, r.city, r.state].filter(Boolean).join(' · '),
        status: 'pending',
      })), { onConflict: 'user_id,source,external_dedupe_key', ignoreDuplicates: true })
      .select('id');
    if (qErr) return NextResponse.json({ error: qErr.message, filled, failed }, { status: 500 });
    queued = (inserted ?? []).map((q) => q.id as string);
  }

  return NextResponse.json({
    rows: preview,
    filled,
    failed,
    queued,
    // Already in the queue from an earlier upload (waiting, or turned down there).
    alreadyQueued: fresh.length - queued.length,
  });
}
