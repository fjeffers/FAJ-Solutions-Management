import type { WorkOrder, EnrichedWorkOrder, Payment, WorkOrderStatus } from './types';

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '';
  const [y, m, day] = d.split('T')[0].split('-');
  return new Date(Number(y), Number(m) - 1, Number(day)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getStatus(wo: WorkOrder, payments: Payment[]): 'paid' | 'partial' | 'pending' {
  const paid = payments
    .filter((p) => p.wo_number === wo.wo_number)
    .reduce((s, p) => s + Number(p.amount), 0);
  if (paid <= 0) return 'pending';
  if (paid >= wo.total_amount) return 'paid';
  return 'partial';
}

export function sortByWO<T extends WorkOrder>(wos: T[]): T[] {
  return [...wos].sort((a, b) => {
    const na = parseInt(a.wo_number, 10);
    const nb = parseInt(b.wo_number, 10);
    if (!isNaN(na) && !isNaN(nb)) return nb - na;
    return b.wo_number.localeCompare(a.wo_number);
  });
}

export function enrichWorkOrders(workOrders: WorkOrder[], payments: Payment[]): EnrichedWorkOrder[] {
  return sortByWO(
    workOrders.map((wo) => {
      const paid = payments
        .filter((p) => p.wo_number === wo.wo_number)
        .reduce((s, p) => s + Number(p.amount), 0);
      const remaining = Math.max(0, wo.total_amount - paid);
      const payment_status: 'paid' | 'partial' | 'pending' =
        paid <= 0 ? 'pending' : paid >= wo.total_amount ? 'paid' : 'partial';
      return { ...wo, paid, remaining, payment_status };
    })
  ) as EnrichedWorkOrder[];
}

export const STATUS_COLORS: Record<WorkOrderStatus, { bg: string; color: string }> = {
  Open:        { bg: 'rgba(156,163,175,0.2)',  color: '#4B5563' },
  Assigned:    { bg: 'rgba(59,130,246,0.15)',  color: '#1D4ED8' },
  'In Progress':{ bg: 'rgba(245,158,11,0.15)', color: '#B45309' },
  'Work Done': { bg: 'rgba(16,185,129,0.15)',  color: '#047857' },
  Approved:    { bg: 'rgba(13,115,119,0.15)',  color: 'var(--teal)' },
  Paid:        { bg: 'rgba(5,150,105,0.2)',    color: '#065F46' },
};
