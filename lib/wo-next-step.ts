// The office's "next step" strip on a work order (Fred, 2026-10-31: "Build ... A 'Next step'
// button on every job"). Every job walks the same eight steps; the strip lights the one the
// job is on and offers one button for what to do next. Pure and unit-tested (wo-next-step.test.ts).
import type { AssignmentResponse } from './types';

export type WoStepKey = 'tech' | 'sent' | 'accepted' | 'onsite' | 'done' | 'approved' | 'invoiced' | 'paid';

export const WO_STEPS: { key: WoStepKey; label: string }[] = [
  { key: 'tech', label: 'Need a tech' },
  { key: 'sent', label: 'Sent' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'onsite', label: 'On site' },
  { key: 'done', label: 'Work done' },
  { key: 'approved', label: 'Approved' },
  { key: 'invoiced', label: 'Invoiced' },
  { key: 'paid', label: 'Paid' },
];

/** What the button does: open a part of the job, or move the status on. */
export type WoNextAction = 'pick-tech' | 'closeout' | 'approve' | 'invoice' | 'mark-paid';

export type WoNextFacts = {
  status?: string | null;
  techs: string[];
  responses?: Record<string, AssignmentResponse> | null;
  checkedIn?: boolean;
  invoiced?: boolean;
  saved: boolean;
};

export type WoNext = {
  step: WoStepKey;
  /** One line under the strip: what the job is waiting on. */
  note: string;
  action: { label: string; do: WoNextAction } | null;
};

const names = (ns: string[]) => (ns.length <= 2 ? ns.join(' and ') : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);

export function woNextStep(f: WoNextFacts): WoNext {
  const status = f.status ?? 'Open';
  // On hold (Fred, 2026-10-31): where it stood, greyed, with nothing to do until it's taken off hold.
  if (status === 'On Hold') {
    return { ...woNextStep({ ...f, status: f.checkedIn ? 'In Progress' : 'Open' }), note: 'On hold. Change the status to pick it back up.', action: null };
  }
  if (status === 'Paid') return { step: 'paid', note: 'Paid. This job is finished.', action: null };
  if (status === 'Approved') {
    return f.invoiced
      ? { step: 'invoiced', note: 'Invoiced. Waiting on the client to pay.', action: { label: 'Mark paid', do: 'mark-paid' } }
      : { step: 'approved', note: 'Approved. Time to bill the client.', action: { label: 'Make the invoice', do: 'invoice' } };
  }
  if (status === 'Work Done') {
    return { step: 'done', note: 'The tech marked the work done. Check the closeout and photos, then approve.',
      action: { label: 'Review and approve', do: 'approve' } };
  }
  if (status === 'In Progress' || f.checkedIn) return { step: 'onsite', note: 'The tech is on the job.', action: null };

  const techs = f.techs.filter((t) => t.trim());
  if (techs.length === 0) return { step: 'tech', note: 'No tech on this job yet.', action: { label: 'Pick a tech', do: 'pick-tech' } };
  const r = f.responses ?? {};
  const declined = techs.filter((t) => r[t]?.status === 'declined');
  if (declined.length) {
    return { step: 'sent', note: `${names(declined)} turned this job down.`, action: { label: 'Pick another tech', do: 'pick-tech' } };
  }
  if (!f.saved) return { step: 'sent', note: `Save to send it to ${names(techs)}.`, action: null };
  const waiting = techs.filter((t) => r[t]?.status !== 'accepted');
  if (waiting.length) return { step: 'sent', note: `Waiting for ${names(waiting)} to accept.`, action: null };
  return { step: 'accepted', note: 'Accepted. Waiting for the tech to check in on the day.', action: null };
}
