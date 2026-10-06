import { redirect } from 'next/navigation';

// The office sign-in moved to /admin/login (see app/page.tsx). Old links land there.
export default async function OldLogin({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(await searchParams)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v != null) q.set(k, v);
  }
  const s = q.toString();
  redirect(s ? `/admin/login?${s}` : '/admin/login');
}
