import { createAdminClient } from '@/lib/supabase/admin';
import { clientExpenseFilename } from '@/lib/client-invoice-pdf';
import type { Invoice, WorkOrder } from '@/lib/types';

export const dynamic = 'force-dynamic';

type Expense = {
  id: string;
  wo_id: string;
  category: string;
  vendor: string | null;
  expense_date: string;
  status: string;
  receipt_path: string | null;
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  if (!token || token.length < 16 || !id) return new Response('Expense not found.', { status: 404 });

  const db = createAdminClient();
  const [{ data: invoice }, { data: expense }] = await Promise.all([
    db.from('invoices').select('*').eq('share_token', token).maybeSingle<Invoice>(),
    db.from('job_expenses').select('id, wo_id, category, vendor, expense_date, status, receipt_path').eq('id', id).maybeSingle<Expense>(),
  ]);
  if (!invoice || !expense?.receipt_path || expense.status !== 'approved' || !invoice.work_order_ids.includes(expense.wo_id)) {
    return new Response('Expense not found.', { status: 404 });
  }

  const [{ data: site }, { data: receipt, error }] = await Promise.all([
    db.from('work_orders').select('site_name, title, client_reference, wo_number').eq('id', expense.wo_id).maybeSingle(),
    db.storage.from('job-receipts').download(expense.receipt_path),
  ]);
  if (error || !receipt) return new Response('Expense not found.', { status: 404 });

  const filename = clientExpenseFilename(
    invoice,
    expense,
    site as Pick<WorkOrder, 'site_name' | 'title' | 'client_reference' | 'wo_number'> | null,
  );
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, ' ').replace(/"/g, '').replace(/\s+/g, ' ').trim() || 'Expense receipt';

  return new Response(await receipt.arrayBuffer(), {
    headers: {
      'content-type': receipt.type || 'application/octet-stream',
      'content-disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'private, no-store',
    },
  });
}
