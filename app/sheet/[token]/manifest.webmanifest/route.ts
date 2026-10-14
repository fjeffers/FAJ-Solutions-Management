import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { projectForToken } from '@/lib/project-sheet-load';

// The sheet's own home-screen app (migration 124): on an iPhone, phone alerts
// need the page added to the Home Screen, and it must open this sheet — not
// the office app's sign-in.
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await projectForToken(createAdminClient(), token);
  if (!p) return new NextResponse('Not found', { status: 404 });
  return NextResponse.json({
    name: `${p.project} · Live sheet`,
    short_name: 'Live sheet',
    id: `/sheet/${token}`,
    start_url: `/sheet/${token}`,
    scope: `/sheet/${token}`,
    display: 'standalone',
    theme_color: '#0E1B2E',
    background_color: '#F4F1EA',
    icons: [
      { src: '/icons/icon-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'no-store' } });
}
