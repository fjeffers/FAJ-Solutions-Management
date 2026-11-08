// The 7 AM pop-up on Fred's phone (Fred, 2026-11-08: "Morning briefing"): today's jobs, what's waiting in the
// inbox, invoices to send, and money owed, in one line each. Pure; app/api/cron/daily-brief sends it.
import { fmtMoney } from './utils';
import type { TechPush } from './tech-push';

export type MorningCounts = {
  jobsToday: number;
  noTech: number;
  unread: number;
  emails: number;
  imports: number;
  invoicesToSend: number;
  overdueTotal: number;
  owedTotal: number;
};

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

/** null when nothing needs Fred: an "all clear" every morning stops being read. */
export function morningPush(c: MorningCounts): TechPush | null {
  const lines: string[] = [];
  if (c.jobsToday) lines.push(`${n(c.jobsToday, 'job')} today${c.noTech ? ` (${c.noTech} with no tech)` : ''}`);
  const inbox = c.unread + c.emails + c.imports;
  if (inbox) lines.push(`Inbox: ${[c.unread && n(c.unread, 'message'), c.emails && n(c.emails, 'email'), c.imports && n(c.imports, 'import')].filter(Boolean).join(', ')}`);
  if (c.invoicesToSend) lines.push(`${n(c.invoicesToSend, 'invoice')} to send`);
  if (c.overdueTotal > 0.005) lines.push(`${fmtMoney(c.overdueTotal)} overdue from clients`);
  if (c.owedTotal > 0.005) lines.push(`${fmtMoney(c.owedTotal)} owed to techs`);
  if (lines.length === 0) return null;
  return { title: 'Good morning — today at FAJ', body: lines.join('\n'), url: '/admin', tag: 'morning-brief' };
}

/** On the job today: started, and not past its end date. */
export const onToday = (j: { start_date: string | null; end_date: string | null }, today: string) =>
  !!j.start_date && j.start_date <= today && (j.end_date || j.start_date) >= today;
