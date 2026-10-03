// A support ticket as the inbox reads it, and the New job form it opens when
// Fred approves it (migration-104). Pure, so it is tested.
import type { SupportQueue } from './support-queues';
import type { WorkOrder } from './types';

export type SupportTicket = {
  id: string; source: 'email' | 'pasted'; from_name: string | null; from_email: string | null; subject: string | null; body: string;
  received_at: string; suggested_queue: SupportQueue | null; suggested_reason: string | null; summary: string | null; urgent: boolean;
  client_name: string | null; site: string | null; wo_number: string | null; contact_name: string | null; contact_phone: string | null;
  job_title: string | null; draft_reply: string | null; triage_error: string | null; status: 'new' | 'approved' | 'dismissed';
  final_queue: SupportQueue | null; assigned_tech: string | null; wo_id: string | null; approved_at: string | null;
};

export const ticketWhen = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const ticketSender = (t: Pick<SupportTicket, 'from_name' | 'from_email'>) => t.from_name || t.from_email || 'Unknown sender';

/** The New job form, filled in from a ticket. The tech is already picked. */
export function jobFromTicket(t: SupportTicket, tech: string): Partial<WorkOrder> {
  const lines = [
    t.summary ?? '',
    t.wo_number ? `They mention WO / ticket ${t.wo_number}.` : '',
    '',
    `From ${ticketSender(t)}${t.from_email && t.from_name ? ` <${t.from_email}>` : ''}, ${ticketWhen(t.received_at)}:`,
    t.body.slice(0, 3000),
  ];
  return {
    title: t.job_title || t.subject || 'Support request',
    customer_name: t.client_name ?? '',
    site_name: t.site ?? '',
    description: lines.filter((l, i) => l || i === 2).join('\n').trim(),
    poc_name: t.contact_name || t.from_name || '',
    poc_phone: t.contact_phone ?? '',
    poc_email: t.from_email ?? '',
    priority: t.urgent ? 'High' : 'Normal',
    contractor_name: tech,
    contractor_names: [tech],
  };
}
