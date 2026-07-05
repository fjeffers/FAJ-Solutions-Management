import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

function client() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// GET /api/portal/messages?token=...&wo_number=...
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const woNumber = searchParams.get('wo_number');
    if (!token || !woNumber) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await client().rpc('get_portal_messages', {
      p_token: token,
      p_wo_number: woNumber,
    });

    if (error) {
      console.error('get_portal_messages error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (data === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ messages: data });
  } catch (err) {
    console.error('Portal messages GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/portal/messages
// Body: { token, wo_number, content }
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, wo_number, content } = body;
    if (!token || !wo_number || !content) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await client().rpc('send_portal_message', {
      p_token: token,
      p_wo_number: wo_number,
      p_content: content,
    });

    if (error) {
      console.error('send_portal_message error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (data === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    return NextResponse.json({ message: data });
  } catch (err) {
    console.error('Portal messages POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
