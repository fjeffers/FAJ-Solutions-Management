// What the tech left undone on a job, for the finished work order (Fred,
// 2026-10-18: "if certain items were not inputted then it should be in the
// final work order"). The Job log print, the client project report and the
// office's job screen list these, so the office and the client see the gaps
// instead of a page that only shows what was filled in.
//
// The tech's own checks (reportMissing, closeoutMissing) say what to do next;
// these say what is missing, one line per item.
//
// Pure and unit-tested (lib/job-gaps.test.ts).

import { skipReason } from './closeout';
import type { WfJob } from './wf';

export type JobGap = {
  /** 'skipped' = the tech couldn't do it and said why; everything else was just left. */
  kind: 'task' | 'question' | 'deliverable' | 'skipped' | 'signature' | 'photos' | 'notes';
  text: string;
};

export function jobGaps(job: WfJob, deliverables: string[], photoCount: number): JobGap[] {
  const gaps: JobGap[] = [];
  for (const t of job.tasks) if (!t.done) gaps.push({ kind: 'task', text: `Checklist not done: ${t.label}` });
  for (const q of job.questions) {
    if (q.answer.trim()) continue;
    gaps.push({ kind: 'question', text: q.type === 'signature' ? `Not signed: ${q.label}` : `Not answered: ${q.label}` });
  }
  const c = job.closeout;
  for (const item of deliverables) {
    if (c.done.includes(item)) continue;
    const why = skipReason(c, item);
    gaps.push(why
      ? { kind: 'skipped', text: `Couldn't be done: ${item} (${why})` }
      : { kind: 'deliverable', text: `Deliverable not done: ${item}` });
  }
  if (job.signatureRequired && !c.signoff) {
    gaps.push({ kind: 'signature', text: c.signSkip ? `No customer signature: ${c.signSkip.reason}` : 'No customer signature' });
  }
  if (job.photoRequired && photoCount === 0) gaps.push({ kind: 'photos', text: 'No photos of the work' });
  if (!job.closeoutNotes.trim()) gaps.push({ kind: 'notes', text: "No notes from the tech on what was done" });
  return gaps;
}
