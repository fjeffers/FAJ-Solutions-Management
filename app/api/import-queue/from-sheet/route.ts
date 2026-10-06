import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@/lib/supabase/server';

// Imports rows from a shared Google Sheet (or text from a Google Doc) into the
// import_queue for review — same approve/reject flow as email imports. Nothing
// touches work_orders until the user approves each row.
//
// The sheet/doc must be shared as "Anyone with the link can view" (or published
// to the web); we fetch Google's public CSV/TXT export server-side.

export const dynamic = 'force-dynamic';

type ParsedFields = {
  title?: string;
  description?: string;
  customer_name?: string;
  client_reference?: string;
  external_wo_id?: string;
  start_date?: string | null;
  total_amount?: number;
};

// ── URL handling ──────────────────────────────────────────────────────────────

function exportUrl(raw: string): { url: string; kind: 'sheet' | 'doc'; docId: string } | null {
  // Published-to-web sheet: /spreadsheets/d/e/2PACX-.../pub...
  let m = raw.match(/docs\.google\.com\/spreadsheets\/d\/e\/([A-Za-z0-9_-]+)/);
  if (m) return { url: `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv`, kind: 'sheet', docId: m[1] };

  // Normal sheet: /spreadsheets/d/{id}/...#gid=N
  m = raw.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]+)/);
  if (m) {
    const gid = raw.match(/[#&?]gid=(\d+)/)?.[1] ?? '0';
    return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`, kind: 'sheet', docId: `${m[1]}:${gid}` };
  }

  // Google Doc: /document/d/{id}/...
  m = raw.match(/docs\.google\.com\/document\/d\/([A-Za-z0-9_-]+)/);
  if (m) return { url: `https://docs.google.com/document/d/${m[1]}/export?format=txt`, kind: 'doc', docId: m[1] };

  return null;
}

// ── CSV parsing (quoted fields, embedded commas/newlines) ─────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

// ── Column mapping ────────────────────────────────────────────────────────────

const COLUMN_MATCHERS: [keyof ParsedFields, string[]][] = [
  ['title',            ['title', 'job name', 'job', 'task', 'project', 'name', 'work description']],
  ['customer_name',    ['customer', 'client', 'company', 'account']],
  ['description',      ['description', 'details', 'notes', 'scope', 'memo', 'instructions']],
  ['start_date',       ['start date', 'service date', 'scheduled', 'date', 'start']],
  ['external_wo_id',   ['work order', 'wo #', 'wo number', 'wo id', 'ticket', 'order id', 'wo']],
  ['client_reference', ['site id', 'agent code', 'reference', 'site', 'ref', 'store']],
  ['total_amount',     ['total amount', 'amount', 'total', 'price', 'pay', 'rate', 'cost']],
];

function mapHeaders(headers: string[]): Map<number, keyof ParsedFields> {
  const mapping = new Map<number, keyof ParsedFields>();
  const claimed = new Set<keyof ParsedFields>();
  for (const [target, keywords] of COLUMN_MATCHERS) {
    for (let i = 0; i < headers.length; i++) {
      if (mapping.has(i) || claimed.has(target)) continue;
      const h = headers[i].trim().toLowerCase();
      if (!h) continue;
      if (keywords.some((k) => h === k || h.includes(k))) {
        mapping.set(i, target);
        claimed.add(target);
        break;
      }
    }
  }
  return mapping;
}

function normalizeDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);           // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);      // M/D/YY or MM/DD/YYYY
  if (m) {
    const yr = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yr}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function normalizeAmount(v: string): number | undefined {
  const n = parseFloat(v.replace(/[$,\s]/g, ''));
  return isNaN(n) ? undefined : n;
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const supabase = await createClient('admin');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const raw: string = body?.url ?? '';
  const target = exportUrl(raw);
  if (!target) {
    return NextResponse.json({ error: 'That doesn\'t look like a Google Sheets or Google Docs link.' }, { status: 400 });
  }

  const res = await fetch(target.url, { redirect: 'follow' });
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok || contentType.includes('text/html')) {
    // Private files redirect to a Google sign-in HTML page instead of exporting.
    return NextResponse.json({
      error: 'Google wouldn\'t share that file. Open it in Google Drive, click Share, and set "Anyone with the link" to Viewer, then try again.',
    }, { status: 422 });
  }
  const text = await res.text();

  const items: { fields: ParsedFields; snippet: string }[] = [];

  if (target.kind === 'doc') {
    // A doc becomes one review item: first line as title, body as description.
    const clean = text.trim();
    if (!clean) return NextResponse.json({ error: 'That document is empty.' }, { status: 422 });
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    items.push({
      fields: { title: lines[0].slice(0, 80), description: clean.slice(0, 2000) },
      snippet: clean.slice(0, 500),
    });
  } else {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return NextResponse.json({ error: 'The sheet needs a header row plus at least one data row.' }, { status: 422 });
    }
    const mapping = mapHeaders(rows[0]);
    if (mapping.size === 0) {
      return NextResponse.json({
        error: `Couldn't recognize any columns. Use headers like: Title, Customer, Description, Date, Work Order, Site ID, Amount. Found: ${rows[0].filter(Boolean).join(', ')}`,
      }, { status: 422 });
    }
    for (const row of rows.slice(1)) {
      const fields: ParsedFields = {};
      mapping.forEach((key, idx) => {
        const v = (row[idx] ?? '').trim();
        if (!v) return;
        if (key === 'start_date') fields.start_date = normalizeDate(v);
        else if (key === 'total_amount') fields.total_amount = normalizeAmount(v);
        else fields[key] = v;
      });
      if (!fields.title) {
        const firstCell = row.find((c) => c.trim() !== '');
        if (!firstCell) continue;
        fields.title = firstCell.trim().slice(0, 80);
      }
      items.push({ fields, snippet: row.filter(Boolean).join(' | ').slice(0, 500) });
    }
  }

  if (items.length === 0) return NextResponse.json({ error: 'No usable rows found.' }, { status: 422 });

  // Dedupe on content hash so re-importing the same sheet doesn't duplicate rows.
  const queueRows = items.map(({ fields, snippet }) => ({
    user_id: user.id,
    source: target.kind === 'doc' ? 'google_docs' : 'google_sheets',
    external_dedupe_key: `${target.docId}:${createHash('sha1').update(JSON.stringify(fields)).digest('hex')}`,
    parsed_fields: fields,
    raw_snippet: snippet,
    status: 'pending',
  }));

  const { data: inserted, error } = await supabase
    .from('import_queue')
    .upsert(queueRows, { onConflict: 'user_id,source,external_dedupe_key', ignoreDuplicates: true })
    .select('id');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const imported = inserted?.length ?? 0;
  return NextResponse.json({ ok: true, imported, skipped: items.length - imported, total: items.length });
}
