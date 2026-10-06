import { redirect } from 'next/navigation';

// The office lives at /admin and the tech portal at /tech (Fred, 2026-10-06:
// "make it app.fajsolutions.com/admin for the administrator login, then
// app.fajsolutions.com/tech for the tech portal"). This keeps every old
// bookmark, email button and QuickBooks/Gmail return link working — the query
// (?view=…, ?wo=…, ?code=…) comes along.
export default async function Root({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v != null) q.set(k, v);
  }
  const s = q.toString();
  redirect(s ? `/admin?${s}` : '/admin');
}
