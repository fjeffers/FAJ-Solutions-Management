import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { projectForToken, projectJobIds } from '@/lib/project-sheet-load';

// GET /sheet/<token>/receipt/<id> — a receipt picture from the live sheet.
// Receipts sit in the private job-receipts bucket; the link only opens one
// that belongs to this project (and wasn't declined), through a signed
// address good for five minutes.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return new Response('Not found', { status: 404 });
  const { data } = await admin.from('job_expenses').select('wo_id, receipt_path, status').eq('id', id).maybeSingle();
  const r = data as { wo_id?: string; receipt_path?: string | null; status?: string } | null;
  if (!r?.wo_id || !r.receipt_path || r.status === 'declined') return new Response('Not found', { status: 404 });
  if (!(await projectJobIds(admin, p.userId, p.project)).includes(r.wo_id)) return new Response('Not found', { status: 404 });
  const { data: signed } = await admin.storage.from('job-receipts').createSignedUrl(r.receipt_path, 300);
  if (!signed?.signedUrl) return new Response('Not found', { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { 'Cache-Control': 'no-store' } });
}
