export async function notifyContractor(params: {
  type: 'wo_assigned' | 'status_change' | 'payment_recorded';
  contractor_email: string;
  contractor_name: string;
  wo_number: string;
  title?: string;
  status?: string;
  amount?: number;
}) {
  if (!params.contractor_email) return;
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Non-critical — don't block the UI
  }
}

export async function sendPortalLink(params: {
  contractor_email: string;
  contractor_name: string;
  portal_url: string;
  work_orders: Array<{
    wo_number: string;
    title?: string | null;
    start_date?: string | null;
    start_time?: string | null;
    site_address?: string | null;
    site_city?: string | null;
    site_state?: string | null;
  }>;
}): Promise<{ ok: boolean; error?: string }> {
  if (!params.contractor_email) return { ok: false, error: 'No email' };
  try {
    const res = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'portal_link', ...params }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      return { ok: false, error: json.error ?? 'Send failed' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
