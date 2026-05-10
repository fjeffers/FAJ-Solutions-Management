import type { WorkOrder, Payment, EnrichedWorkOrder } from './types';

export const fmtMoney = (n: number | null | undefined): string => {
  if (n === null || n === undefined || isNaN(n)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
};

export const fmtDate = (d: string | null | undefined): string => {
  if (!d) return '—';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const getStatus = (total: number, paid: number): 'paid' | 'partial' | 'pending' => {
  if (paid >= total && total > 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'pending';
};

export const sortByWO = <T extends { wo_number: string }>(arr: T[]): T[] => {
  return [...arr].sort((a, b) =>
    (a.wo_number || '').localeCompare(b.wo_number || '', undefined, { numeric: true })
  );
};

export const enrichWorkOrders = (
  workOrders: WorkOrder[],
  payments: Payment[]
): EnrichedWorkOrder[] => {
  return sortByWO(
    workOrders.map((wo) => {
      const paid = payments
        .filter((p) => p.wo_number === wo.wo_number)
        .reduce((s, p) => s + Number(p.amount || 0), 0);
      const s = getStatus(Number(wo.total_amount), paid);
      return {
        ...wo,
        paid,
        remaining: Number(wo.total_amount) - paid,
        status: s,
        payment_status: s,
      };
    })
  );
};
