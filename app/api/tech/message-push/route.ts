import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { ownerOnly } from '@/lib/security';
import { messagePush, pushToTech } from '@/lib/tech-push';
import { techsOf } from '@/lib/job-sheet';

// POST /api/tech/message-push { wo_number, content } — the office wrote in a job's thread
// (Fred, 2026-11-01: "when i send a message they not getting the alert?"). Sends a phone
// pop-up to each tech on the job; says who it reached so the office knows who didn't get it.
export async function POST(req: Request) {
  // The office's sign-in (only the owner sends from a job's thread).
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const denied = await ownerOnly(supabase);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { wo_number?: unknown; content?: unknown };
  const woNumber = String(body.wo_number ?? '').slice(0, 40);
  const content = String(body.content ?? '').slice(0, 2000);
  if (!woNumber || !content.trim()) return NextResponse.json({ ok: false }, { status: 400 });

  const admin = createAdminClient();
  const { data } = await admin.from('work_orders').select('id, wo_number, wo_status, contractor_name, contractor_names')
    .eq('user_id', user.id).eq('wo_number', woNumber).maybeSingle();
  const w = data as { id: string; wo_number: string; wo_status: string | null; contractor_name: string; contractor_names: string[] | null } | null;
  if (!w) return NextResponse.json({ ok: false }, { status: 404 });
  // A held job is hidden from techs, so its messages don't ring their phones either.
  if (w.wo_status === 'On Hold') return NextResponse.json({ ok: true, techs: [] });

  const techs: { name: string; pushed: number }[] = [];
  for (const name of techsOf(w)) {
    let pushed = 0;
    try { pushed = await pushToTech(admin, user.id, name, messagePush({ woId: w.id, woNumber: w.wo_number, content })); } catch { /* counted as not reached */ }
    techs.push({ name, pushed });
  }
  return NextResponse.json({ ok: true, techs });
}
