import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

// GET /api/portal/validate-closeout?token=xxx&wo_id=xxx
// Returns { missing: string[] } — empty array means all requirements met
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const wo_id = searchParams.get('wo_id');

    if (!token || !wo_id) {
      return NextResponse.json({ error: 'Missing token or wo_id' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    // Validate token and fetch WO data via the portal RPC
    const { data, error } = await supabase.rpc('get_portal_data', { p_token: token });

    if (error || !data) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const wo = (data.work_orders as Record<string, unknown>[])?.find(
      (w) => w.id === wo_id,
    );

    if (!wo) {
      return NextResponse.json({ error: 'Work order not found' }, { status: 404 });
    }

    const missing: string[] = [];

    // 1. Closeout notes — always required
    const notes = (wo.closeout_notes as string | null) ?? '';
    if (!notes.trim()) {
      missing.push('Closeout notes are required before marking work done.');
    }

    // 2. Photos — required if photo_required flag is set
    if (wo.photo_required) {
      const docUrls: string[] = (wo.doc_urls as string[] | null) ?? [];
      const hasPhoto = docUrls.some((u) => {
        const seg = u.split('/').pop() ?? '';
        return /^\d{13}\./.test(seg) && /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(seg);
      });
      if (!hasPhoto) {
        missing.push('At least one photo is required.');
      }
    }

    // 3. Signature — required if signature_required flag is set
    if (wo.signature_required) {
      const qa = (wo.custom_qa as Array<{ type: string; answer: string | null }> | null) ?? [];
      const hasSig = qa.some((item) => item.type === 'signature' && item.answer);
      if (!hasSig) {
        missing.push('A signature is required.');
      }
    }

    // 4. All Q&A items must be answered
    const qa = (wo.custom_qa as Array<{ label: string; answer: string | null }> | null) ?? [];
    const unanswered = qa.filter((item) => !item.answer);
    if (unanswered.length > 0) {
      const labels = unanswered.map((i) => i.label).join(', ');
      missing.push(`These fields need to be completed: ${labels}`);
    }

    return NextResponse.json({ missing });
  } catch (err) {
    console.error('validate-closeout error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
