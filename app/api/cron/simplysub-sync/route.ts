import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { copySimplySubPdfs } from '@/lib/simplysub-documents';
import {
  findSimplySubJobsBySiteNumber,
  mergeSimplySubItems,
  mergeSimplySubWorkflow,
} from '@/lib/simplysub-sync';
import type { CustomQAItem, WoTask } from '@/lib/types';

const siteNumber = (value: unknown) =>
  typeof value === 'string' ? value.match(/\b(\d{7})\b/)?.[1] ?? '' : '';

const isFridayAtThree = (now: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return parts.weekday === 'Fri' && Number(parts.hour) === 15;
};

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.SIMPLYSUB_SYNC_SECRET || auth !== `Bearer ${process.env.SIMPLYSUB_SYNC_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force = new URL(req.url).searchParams.get('force') === '1';
  const now = new Date();
  if (!force && !isFridayAtThree(now)) {
    return NextResponse.json({ ok: true, skipped: 'outside Friday 3 PM America/New_York' });
  }

  const email = process.env.SIMPLYSUB_EMAIL;
  const password = process.env.SIMPLYSUB_PASSWORD;
  if (!email || !password) {
    return NextResponse.json({ error: 'SimplySub login is not configured.' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: workOrders, error: workOrderError } = await admin
    .from('work_orders')
    .select('id, user_id, wo_number, title, site_name, client_reference, client_status, custom, wo_tasks, custom_qa, client_links, doc_urls, deliverable_link, deliverables')
    .is('archived_at', null);
  if (workOrderError) return NextResponse.json({ error: workOrderError.message }, { status: 500 });

  const bySite = new Map<string, typeof workOrders>();
  for (const workOrder of workOrders ?? []) {
    const number = siteNumber(workOrder.client_reference)
      || siteNumber(workOrder.site_name)
      || siteNumber(workOrder.title);
    if (!number) continue;
    bySite.set(number, [...(bySite.get(number) ?? []), workOrder]);
  }

  const simplySub = await findSimplySubJobsBySiteNumber(email, password, now);
  let updated = 0;
  let copiedDocuments = 0;
  const results: { site: string; workOrders: string[] }[] = [];

  for (const match of simplySub.matches) {
    const targets = bySite.get(match.siteNumber) ?? [];
    if (!targets.length) continue;
    const sync = await simplySub.load(match, targets[0].deliverable_link);
    const fields = sync.fields;
    const sourceDocs = Array.isArray(fields.source_documents) ? fields.source_documents : [];

    for (const workOrder of targets) {
      const workflow = mergeSimplySubWorkflow(
        {
          wo_tasks: workOrder.wo_tasks as WoTask[] | null,
          custom_qa: workOrder.custom_qa as CustomQAItem[] | null,
        },
        {
          wo_tasks: fields.wo_tasks as WoTask[] | undefined,
          custom_qa: fields.custom_qa as CustomQAItem[] | undefined,
        },
      );
      const sourceUrls = sourceDocs
        .map((doc: { url?: unknown }) => doc.url)
        .filter((url: unknown): url is string => typeof url === 'string');
      const existingUrls = workOrder.doc_urls as string[] | null;
      const newDocuments = sourceDocs.filter((doc: { url?: unknown }) =>
        typeof doc.url === 'string' && !(existingUrls ?? []).includes(doc.url));
      const deliverables = mergeSimplySubItems(
        String(workOrder.deliverables ?? '').split('\n').filter(Boolean),
        String(fields.deliverables ?? '').split('\n').filter(Boolean),
        (value) => value,
      ).join('\n');

      const { error: updateError } = await admin.from('work_orders').update({
        ...workflow,
        client_links: mergeSimplySubItems(
          workOrder.client_links as string[] | null,
          fields.client_links ?? [],
          (value) => value,
        ),
        doc_urls: mergeSimplySubItems(existingUrls, sourceUrls, (value) => value),
        deliverable_link: fields.deliverable_link || workOrder.deliverable_link,
        deliverables,
        client_status: sync.summary.status || workOrder.client_status,
        custom: {
          ...((workOrder.custom && typeof workOrder.custom === 'object') ? workOrder.custom : {}),
          _simplysub_sync: sync.summary,
        },
      }).eq('id', workOrder.id);
      if (updateError) throw new Error(`WO ${workOrder.wo_number}: ${updateError.message}`);

      copiedDocuments += await copySimplySubPdfs(
        admin,
        newDocuments,
        workOrder.user_id,
        workOrder.id,
      );
      updated += 1;
    }
    results.push({ site: match.siteNumber, workOrders: targets.map((target) => target.wo_number) });
  }

  return NextResponse.json({
    ok: true,
    simplysub_jobs: simplySub.matches.length,
    matched_sites: results.length,
    updated_work_orders: updated,
    copied_documents: copiedDocuments,
    results,
  });
}
