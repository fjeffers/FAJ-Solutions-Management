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
