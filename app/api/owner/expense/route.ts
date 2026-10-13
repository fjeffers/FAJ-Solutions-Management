import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { expenseReasonText, parseExpenseAmount } from '@/lib/expenses';

// POST /api/owner/expense — Fred adds a receipt to a job himself (Fred,
// 2026-10-13: "me being as an admin, I could basically add the hotels ... at a
// later time"). Migration 117. FormData: wo_id, category, vendor, amount, date
// (YYYY-MM-DD), note, file (optional photo or PDF of the receipt).
// The receipt goes to the private job-receipts bucket under the job's id and
// is recorded by wf_owner_add_expense as paid by FAJ: approved, never a pay
// line for a tech.
//
// DELETE /api/owner/expense?id= — removes a receipt the office added (a typo),
// and its file. Tech receipts are declined, never removed.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

async function owner() {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woId = String(form.get('wo_id') ?? '').trim();
  const amount = parseExpenseAmount(String(form.get('amount') ?? ''));
  const category = String(form.get('category') ?? '');
  const vendor = String(form.get('vendor') ?? '').trim();
  const date = String(form.get('date') ?? '').slice(0, 10);
  const note = String(form.get('note') ?? '').trim();
  const file = form.get('file');
  if (!/^[0-9a-f-]{36}$/i.test(woId)) return NextResponse.json({ ok: false, error: 'Missing the job.' }, { status: 400 });
  if (amount == null) return NextResponse.json({ ok: false, error: expenseReasonText('bad_amount') }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: expenseReasonText('bad_date') }, { status: 400 });

  const { supabase, user } = await owner();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const { data: wo } = await supabase.from('work_orders').select('id').eq('id', woId).eq('user_id', user.id).maybeSingle();
  if (!wo) return NextResponse.json({ ok: false, error: 'That job was not found.' }, { status: 404 });

  const admin = createAdminClient();
  let path: string | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That receipt file is too large (4 MB at most).' }, { status: 413 });
    const ext = TYPES[file.type];
    if (!ext) return NextResponse.json({ ok: false, error: 'The receipt must be a photo (JPG or PNG) or a PDF.' }, { status: 415 });
    path = `${wo.id}/office_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await admin.storage.from('job-receipts').upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type, upsert: false,
    });
    if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the receipt. Try again." }, { status: 500 });
  }

  const { data, error } = await supabase.rpc('wf_owner_add_expense', {
    p_wo_id: wo.id, p_category: category, p_vendor: vendor, p_amount: amount, p_date: date, p_note: note, p_receipt_path: path,
  });
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (error || !r.ok) {
    if (path) await admin.storage.from('job-receipts').remove([path]);
    return NextResponse.json({ ok: false, error: expenseReasonText(r.reason ?? '') }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 });
  const { supabase, user } = await owner();
  if (!user) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await supabase.rpc('wf_owner_remove_expense', { p_id: id });
  const r = (data ?? {}) as { ok?: boolean; reason?: string; receipt_path?: string | null };
  if (error || !r.ok) return NextResponse.json({ ok: false, error: expenseReasonText(r.reason ?? '') }, { status: 400 });
  if (r.receipt_path) await createAdminClient().storage.from('job-receipts').remove([r.receipt_path]);
  return NextResponse.json({ ok: true });
}
