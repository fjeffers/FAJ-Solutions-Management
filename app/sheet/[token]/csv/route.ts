import { createAdminClient } from '@/lib/supabase/admin';
import { loadSheet, projectForToken } from '@/lib/project-sheet-load';
import { pageRows, sheetCsv } from '@/lib/project-sheet';
import { UTF8_BOM } from '@/lib/csv';

// GET /sheet/<token>/csv[?site=<wo>] — the live sheet for Excel: one site's
// page, or the whole project. Same lines, same rules as the page.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const p = await projectForToken(admin, token);
  if (!p) return new Response('Not found', { status: 404 });
  const sheet = await loadSheet(admin, p.userId, p.project, 0);
  const wo = new URL(req.url).searchParams.get('site');
  const site = wo ? sheet.sites.find((s) => s.wo === wo) : null;
  const rows = site ? pageRows(sheet, site.id, null) : sheet.rows;
  const base = new URL(req.url).origin;
  const csv = sheetCsv(rows, (id) => `${base}/sheet/${token}/receipt/${id}`);
  const name = `${sheet.project}${site ? ` WO ${site.wo}` : ''} sheet`.replace(/[^A-Za-z0-9 #._-]+/g, '').trim() || 'project sheet';
  return new Response(UTF8_BOM + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
