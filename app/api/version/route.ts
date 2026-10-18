import { NextResponse } from 'next/server';

// GET /api/version: which build is live, so an open app can tell it is out of
// date (Fred, 2026-10-18: his phone kept this morning's tech app open all day
// and showed the old job screen). Public on purpose: it says nothing but the
// build's id.
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA || 'dev' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
