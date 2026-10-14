import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadSheet, projectForToken } from '@/lib/project-sheet-load';
import ProjectSheetView from '@/components/ProjectSheetView';

// The live project sheet (migration 120), reached by the project's unguessable
// link: no login, read-only, allowed through proxy.ts. The server reads with
// the service key and hands the page finished lines only (lib/project-sheet.ts):
// no price, no tech pay. A wrong link 404s rather than hinting a sheet exists.
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Live project sheet', robots: { index: false, follow: false } };

export default async function SheetPage({ params, searchParams }: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ site?: string | string[]; tech?: string | string[] }>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return notFound();
  const sheet = await loadSheet(admin, p.userId, p.project, 1);
  return (
    <ProjectSheetView sheet={sheet} token={token} initialSite={one(sp.site)} initialTech={one(sp.tech)} updatedAt={new Date().toISOString()} />
  );
}
