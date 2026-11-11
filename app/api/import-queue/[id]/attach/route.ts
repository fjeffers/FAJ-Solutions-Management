import { NextResponse } from 'next/server';
import { ownerOnly } from '@/lib/security';
import { copySimplySubPdfs } from '@/lib/simplysub-documents';
import { createClient } from '@/lib/supabase/server';
import type { CustomQAItem, WoTask } from '@/lib/types';

const mergeBy = <T>(current: T[] | null, incoming: T[], key: (value: T) => string): T[] => {
  const seen = new Set((current ?? []).map((value) => key(value).toLowerCase()));
  return [...(current ?? []), ...incoming.filter((value) => {
    const k = key(value).toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  })];
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { work_order_id?: unknown };
  const workOrderId = typeof body.work_order_id === 'string' ? body.work_order_id : '';
  if (!workOrderId) return NextResponse.json({ error: 'Choose a work order.' }, { status: 400 });

  const [{ data: item }, { data: workOrder }] = await Promise.all([
    supabase.from('import_queue').select('*').eq('id', id).eq('user_id', user.id).single(),
    supabase.from('work_orders')
      .select('id, wo_number, wo_tasks, custom_qa, client_links, doc_urls, deliverable_link, deliverables')
      .eq('id', workOrderId).eq('user_id', user.id).single(),
  ]);
  if (!item || !workOrder) return NextResponse.json({ error: 'Import or work order not found.' }, { status: 404 });
  if (item.status !== 'pending') return NextResponse.json({ error: 'Already reviewed.' }, { status: 400 });
  if (item.source !== 'simplysub') return NextResponse.json({ error: 'Only SimplySub imports can be added to an existing job.' }, { status: 400 });

  const f = item.parsed_fields;
  const incomingTasks = Array.isArray(f.wo_tasks) ? f.wo_tasks as WoTask[] : [];
  const incomingQuestions = Array.isArray(f.custom_qa) ? f.custom_qa as CustomQAItem[] : [];
  const incomingLinks = Array.isArray(f.client_links) ? f.client_links.filter((x: unknown): x is string => typeof x === 'string') : [];
  const sourceDocs = Array.isArray(f.source_documents) ? f.source_documents : [];
  const sourceUrls = sourceDocs.map((d: { url?: unknown }) => d.url).filter((url: unknown): url is string => typeof url === 'string');
  const deliverables = mergeBy(
    String(workOrder.deliverables ?? '').split('\n').filter(Boolean),
    String(f.deliverables ?? '').split('\n').filter(Boolean),
    (value) => value,
  ).join('\n');

  const { error: updateError } = await supabase.from('work_orders').update({
    wo_tasks: mergeBy(workOrder.wo_tasks as WoTask[] | null, incomingTasks, (task) => task.label),
    custom_qa: mergeBy(workOrder.custom_qa as CustomQAItem[] | null, incomingQuestions, (question) => question.label),
    client_links: mergeBy(workOrder.client_links as string[] | null, incomingLinks, (value) => value),
    doc_urls: mergeBy(workOrder.doc_urls as string[] | null, sourceUrls, (value) => value),
    deliverable_link: f.deliverable_link || workOrder.deliverable_link,
    deliverables,
  }).eq('id', workOrder.id).eq('user_id', user.id);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  const copiedDocuments = await copySimplySubPdfs(supabase, sourceDocs, user.id, workOrder.id);
  const { error: queueError } = await supabase.from('import_queue').update({
    status: 'approved',
    reviewed_at: new Date().toISOString(),
    created_work_order_id: workOrder.id,
  }).eq('id', id).eq('user_id', user.id);
  if (queueError) return NextResponse.json({ error: queueError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    work_order_id: workOrder.id,
    wo_number: workOrder.wo_number,
    copied_documents: copiedDocuments,
  });
}
