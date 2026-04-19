import type { WorkOrder, Payment, EnrichedWorkOrder } from './types';

export function fmtMoney(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function enrichWorkOrders(workOrders: WorkOrder[], payments: Payment[]): EnrichedWorkOrder[] {
  return workOrders.map((w) => {
    const paid = payments
      .filter((p) => p.wo_number === w.wo_number)
      .reduce((s, p) => s + Number(p.amount), 0);
    const remaining = Number(w.total_amount) - paid;
    const status: EnrichedWorkOrder['status'] =
      remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    return { ...w, paid, remaining, status };
  });
}

export function sortByWO<T extends { wo_number: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const na = parseInt(a.wo_number.replace(/\D/g, '')) || 0;
    const nb = parseInt(b.wo_number.replace(/\D/g, '')) || 0;
    return na - nb;
  });
}
