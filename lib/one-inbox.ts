// One inbox on Home (Fred, 2026-11-08: "I need a platform where I can see everything"): tech and client messages
// not read yet, job emails not yet sorted (Support), and work orders waiting in Import, newest first. Each opens
// where it's answered. Pure; components/OneInbox.tsx loads the rows.
import { directContractorId, type InboxMessage } from './messages-inbox';

export type InboxTicket = { id: string; from_name: string | null; from_email: string | null; subject: string | null;
  summary: string | null; received_at: string; urgent: boolean };
export type InboxImport = { id: string; status: string; created_at: string; parsed_fields: { title?: string; customer_name?: string } | null };
export type OneItem = {
  key: string;
  kind: 'tech' | 'client' | 'email' | 'import';
  who: string;
  text: string;
  at: string;
  urgent: boolean;
  /** The job it opens, for messages. */
  woId: string | null;
  /** The screen it opens otherwise. */
  view: string;
};

export const unreadFromField = (m: Pick<InboxMessage, 'sender_role' | 'read_at'>) =>
  (m.sender_role === 'contractor' || m.sender_role === 'client') && !m.read_at;

const one = (s: string | null | undefined, max = 140) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

export function oneInbox({ messages, tickets, imports, jobs }: {
  messages: InboxMessage[];
  tickets: InboxTicket[];
  imports: InboxImport[];
  /** wo_number → job id. */
  jobs: Map<string, string>;
}): OneItem[] {
  const out: OneItem[] = [];
  // One row per job and sender, the latest message, so ten texts from a tech don't fill the list.
  const seen = new Map<string, OneItem>();
  for (const m of messages) {
    if (!unreadFromField(m)) continue;
    const client = m.sender_role === 'client';
    const direct = directContractorId(m.work_order_id);
    const k = `${m.work_order_id}|${m.sender_role}|${m.sender_name}`;
    const was = seen.get(k);
    if (was && was.at >= m.created_at) continue;
    seen.set(k, {
      key: `m:${m.id}`, kind: client ? 'client' : 'tech',
      who: direct ? `${m.sender_name || 'A tech'} · Direct message` : `${m.sender_name || (client ? 'Client' : 'A tech')} · WO ${m.work_order_id}`,
      text: one(m.content), at: m.created_at, urgent: false, woId: jobs.get(m.work_order_id) ?? null, view: 'messages',
    });
  }
  out.push(...seen.values());
  for (const t of tickets) {
    out.push({
      key: `t:${t.id}`, kind: 'email', who: t.from_name || t.from_email || 'Email', text: one(t.summary || t.subject),
      at: t.received_at, urgent: t.urgent, woId: null, view: 'support',
    });
  }
  for (const i of imports) {
    if (i.status !== 'pending') continue;
    const f = i.parsed_fields ?? {};
    out.push({
      key: `i:${i.id}`, kind: 'import', who: f.customer_name || 'New work order', text: one(f.title) || 'Waiting to be added',
      at: i.created_at, urgent: false, woId: null, view: 'import-queue',
    });
  }
  return out.sort((a, b) => (a.urgent !== b.urgent ? (a.urgent ? -1 : 1) : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export const KIND_LABEL: Record<OneItem['kind'], string> = { tech: 'Tech', client: 'Client', email: 'Email', import: 'Import' };
