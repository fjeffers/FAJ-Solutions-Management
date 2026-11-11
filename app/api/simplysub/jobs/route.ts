import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { ownerOnly } from '@/lib/security';
import { findSimplySubJobsBySiteNumber } from '@/lib/simplysub-sync';

const siteNumber = (value: unknown) =>
  typeof value === 'string' ? value.match(/\b(\d{7})\b/)?.[1] ?? '' : '';

export async function GET() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;

  const email = process.env.SIMPLYSUB_EMAIL;
  const password = process.env.SIMPLYSUB_PASSWORD;
  if (!email || !password) {
    return NextResponse.json({ error: 'SimplySub login is not configured.' }, { status: 503 });
  }

  try {
    const [{ matches }, { data: workOrders, error }] = await Promise.all([
      findSimplySubJobsBySiteNumber(email, password),
      supabase.from('work_orders')
        .select('id, wo_number, title, site_name, client_reference, archived_at')
        .eq('user_id', user.id),
    ]);
    if (error) throw error;

    const bySite = new Map<string, { id: string; wo_number: string; title: string | null; archived_at: string | null }>();
    for (const workOrder of workOrders ?? []) {
      const number = siteNumber(workOrder.client_reference) || siteNumber(workOrder.site_name) || siteNumber(workOrder.title);
      if (number && !bySite.has(number)) bySite.set(number, workOrder);
    }
    const jobs = matches.map((job) => {
      const linked = bySite.get(job.siteNumber) ?? null;
      return {
        job_id: job.jobId,
        site_number: job.siteNumber,
        title: job.title,
        source_url: job.sourceUrl,
        work_order_id: linked?.id ?? null,
        work_order_number: linked?.wo_number ?? null,
        linked_title: linked?.title ?? null,
        archived: Boolean(linked?.archived_at),
      };
    });

    return NextResponse.json({
      ok: true,
      jobs,
      open: jobs.length,
      linked: jobs.filter((job) => job.work_order_id).length,
      new_to_faj: jobs.filter((job) => !job.work_order_id).length,
      at: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
