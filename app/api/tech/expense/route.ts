import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { expenseReasonText, parseExpenseAmount } from '@/lib/expenses';
import { fitReceiptAi } from '@/lib/photo-read';

// POST /api/tech/expense — a tech records a receipt on their own job from the
// tech portal (migration-103). FormData: wo_number, amount, category, vendor,
// date (YYYY-MM-DD), note, file (optional JPEG of the receipt).
//
// The tech's own session asks first whether this is their live job
// (wf_tech_photo_target). The receipt photo goes to the private job-receipts
// bucket under that job's id; the expense is then recorded as the tech
// (wf_tech_add_expense), which checks everything again.
//
// Also (migration 128): gallons on a fuel receipt, and ai — what the AI read
// off the photo (lib/photo-read.ts) — so the weekly bill can flag a typed
// amount that differs from the receipt. Before 128 they're left off.
const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }); }
  const woNumber = String(form.get('wo_number') ?? '').trim();
  const amount = parseExpenseAmount(String(form.get('amount') ?? ''));
  const category = String(form.get('category') ?? '');
  const vendor = String(form.get('vendor') ?? '').trim();
  const date = String(form.get('date') ?? '').slice(0, 10);
  const note = String(form.get('note') ?? '').trim();
  const file = form.get('file');
  const gallonsRaw = String(form.get('gallons') ?? '').trim();
  const gallons = gallonsRaw && category === 'fuel' ? Number(gallonsRaw) : null;
  let ai: Record<string, unknown> | null = null;
  const aiText = String(form.get('ai') ?? 'null');
  // A real receipt's reading is a few KB; anything far bigger is ignored unread.
  if (aiText.length <= 32_768) {
    try {
      const parsed = JSON.parse(aiText);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ai = fitReceiptAi(parsed);
    } catch { /* none */ }
  }
  if (gallons != null && !(gallons > 0 && gallons < 1000)) return NextResponse.json({ ok: false, error: 'Enter the gallons on the fuel receipt.' }, { status: 400 });
  if (!woNumber) return NextResponse.json({ ok: false, error: 'Missing the job.' }, { status: 400 });
  if (amount == null) return NextResponse.json({ ok: false, error: expenseReasonText('bad_amount') }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ ok: false, error: expenseReasonText('bad_date') }, { status: 400 });

  const supabase = await createClient('field');
  const { data: target } = await supabase.rpc('wf_tech_photo_target', { p_wo_number: woNumber });
  const woId = (target as { wo_id?: string } | null)?.wo_id;
  if (!woId) return NextResponse.json({ ok: false, error: expenseReasonText('closed_or_not_yours') }, { status: 403 });

  const admin = createAdminClient();
  let path: string | null = null;
  if (file instanceof Blob && file.size > 0) {
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'That receipt photo is too large to send.' }, { status: 413 });
    if (file.type && file.type !== 'image/jpeg') return NextResponse.json({ ok: false, error: 'The receipt must be a photo.' }, { status: 415 });
    path = `${woId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error: upErr } = await admin.storage.from('job-receipts').upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: 'image/jpeg', upsert: false,
    });
    if (upErr) return NextResponse.json({ ok: false, error: "Couldn't store the receipt photo. Try again." }, { status: 500 });
  }

  const args = { p_wo_number: woNumber, p_category: category, p_vendor: vendor, p_amount: amount, p_date: date, p_note: note, p_receipt_path: path };
  let { data, error } = gallons != null || ai
    ? await supabase.rpc('wf_tech_add_expense', { ...args, p_gallons: gallons, p_ai: ai })
    : await supabase.rpc('wf_tech_add_expense', args);
  // Before migration 128 there's only the 7-argument function.
  if (error?.code === 'PGRST202') ({ data, error } = await supabase.rpc('wf_tech_add_expense', args));
  const r = (data ?? {}) as { ok?: boolean; reason?: string };
  if (error || !r.ok) {
    if (path) await admin.storage.from('job-receipts').remove([path]);
    return NextResponse.json({ ok: false, error: expenseReasonText(r.reason ?? '') }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
