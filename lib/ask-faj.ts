// Ask FAJ (Fred, 2026-11-08: PandaOS "stop juggling disconnected apps"): the search box also takes plain
// requests: "pay Paul for 191", "what do I owe", "new job", "open 191", "messages". Each turns into one action
// that opens the right screen or form, filled in; nothing is saved until Fred saves it there. Plain rules, no
// model: instant, free, and the money it quotes is exact (the jobs' own remaining).
import { fmtMoney } from './utils';

export type AskJob = {
  id: string; wo_number: string; title?: string | null; contractor_name: string; contractor_names?: string[] | null;
  remaining: number; archived_at?: string | null;
};
export type AskAction =
  | { kind: 'pay'; woId: string; label: string }
  | { kind: 'open'; woId: string; label: string }
  | { kind: 'new-job'; label: string }
  | { kind: 'view'; view: string; label: string }
  | { kind: 'answer'; text: string; view: string; label: string };

const OWED = 0.005;

const SCREENS: [RegExp, string, string][] = [
  [/\b(messages?|texts?|chat)\b/, 'messages', 'Open Messages'],
  [/\b(emails?|support|tickets?)\b/, 'support', 'Open Support (job emails)'],
  [/\bimports?\b/, 'import-queue', 'Open Import'],
  [/\b(schedul\w*|calendar)\b/, 'scheduling', 'Open Schedule'],
  [/\b(overdue|unpaid invoices?|invoices?)\b/, 'invoices', 'Open Invoices'],
  [/\bquotes?\b/, 'quotes', 'Open Quotes'],
  [/\bsurveys?\b/, 'surveys', 'Open Surveys'],
  [/\b1099s?\b/, '1099', 'Open 1099s'],
  [/\b(payables?|pay techs?)\b/, 'payables', 'Open Payables'],
  [/\b(techs?|contractors?)\b/, 'contractors', 'Open Contractors'],
  [/\b(late|in the field|where)\b/, 'workorders', "See who's late (Home → In the field)"],
];

const techsOf = (j: AskJob) => (j.contractor_names?.length ? j.contractor_names : [j.contractor_name]).filter(Boolean);

/** The techs the words name: a full name, or a first name only one tech has. */
export function techsNamed(q: string, techs: string[]): string[] {
  const words = new Set(q.toLowerCase().split(/[^a-z']+/).filter(Boolean));
  const full = techs.filter((t) => t && q.toLowerCase().includes(t.toLowerCase()));
  if (full.length) return full;
  const byFirst = techs.filter((t) => words.has(t.toLowerCase().split(/\s+/)[0]));
  return byFirst;
}

export function askFaj(raw: string, jobs: AskJob[], techs: string[]): AskAction[] {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: AskAction[] = [];
  const num = q.match(/\b(\d{3,})\b/)?.[1];
  const job = num ? jobs.find((j) => j.wo_number === num) ?? jobs.find((j) => j.wo_number.endsWith(num)) : undefined;
  const named = techsNamed(q, techs);
  const isPay = /^pay\b|\bpay (him|her|them|the tech)\b/.test(q);

  if (isPay) {
    if (job) {
      out.push(job.remaining > OWED
        ? { kind: 'pay', woId: job.id, label: `Pay ${job.contractor_name || 'the tech'} ${fmtMoney(job.remaining)} for WO ${job.wo_number}` }
        : { kind: 'answer', text: `WO ${job.wo_number} is paid in full.`, view: 'payments', label: 'Open Payments' });
    } else if (named.length === 1) {
      const owed = jobs.filter((j) => j.remaining > OWED && techsOf(j).includes(named[0]));
      if (owed.length === 1) {
        out.push({ kind: 'pay', woId: owed[0].id, label: `Pay ${named[0]} ${fmtMoney(owed[0].remaining)} for WO ${owed[0].wo_number}` });
      } else if (owed.length > 1) {
        for (const j of owed.slice(0, 5)) out.push({ kind: 'pay', woId: j.id, label: `Pay ${named[0]} ${fmtMoney(j.remaining)} for WO ${j.wo_number}` });
      } else {
        out.push({ kind: 'answer', text: `Nothing is owed to ${named[0]}.`, view: 'payables', label: 'Open Payables' });
      }
    } else {
      out.push({ kind: 'view', view: 'payables', label: 'Open Payables to pick who to pay' });
    }
    return out;
  }

  if (/\b(owe|owed|owing)\b/.test(q)) {
    const owed = jobs.filter((j) => j.remaining > OWED && (!named.length || techsOf(j).some((t) => named.includes(t))));
    const total = owed.reduce((s, j) => s + j.remaining, 0);
    const who = named.length === 1 ? named[0] : 'your techs';
    out.push({
      kind: 'answer', view: 'payables', label: 'Open Payables',
      text: owed.length ? `You owe ${who} ${fmtMoney(total)} on ${owed.length} job${owed.length === 1 ? '' : 's'}.` : `You don't owe ${who} anything.`,
    });
    return out;
  }

  if (/\bnew (job|work ?order|order|wo)\b|\badd (a )?(job|work ?order)\b/.test(q)) return [{ kind: 'new-job', label: 'Start a new work order' }];

  if (job) out.push({ kind: 'open', woId: job.id, label: `Open WO ${job.wo_number}${job.title ? ` · ${job.title}` : ''}` });
  for (const [re, view, label] of SCREENS) {
    if (out.length >= 3) break;
    if (re.test(q)) out.push({ kind: 'view', view, label });
  }
  return out;
}
