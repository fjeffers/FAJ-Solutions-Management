import { describe, it, expect } from 'vitest';
import { jobGaps } from './job-gaps';
import { wfJobFromOwner } from './wf';

const job = (o: Record<string, unknown> = {}) => wfJobFromOwner({
  id: 'a', wo_number: '101', wo_status: 'Work Done', contractor_names: ['Dana'], contractor_name: 'Dana',
  wo_tasks: [{ id: 't1', label: 'Pull 12 drops', completed: true }, { id: 't2', label: 'Label both ends', completed: false }],
  custom_qa: [
    { id: 'q1', label: 'Serial number?', type: 'text', answer: 'SN-1' },
    { id: 'q2', label: 'How many drops tested?', type: 'number', answer: '' },
    { id: 'q3', label: 'Manager signature', type: 'signature', answer: ' ' },
  ],
  closeout: { done: ['Before photos'], skipped: { 'Cable test results': 'Tester broke' }, sign_skip: { reason: 'Manager not on site', at: '2026-10-18T15:00:00Z' } },
  signature_required: true, photo_required: true, closeout_notes: '', ...o,
});
const items = ['Before photos', 'Cable test results', 'Work area cleaned up'];

describe('what the tech left undone', () => {
  it('lists every item not filled in, one line each', () => {
    expect(jobGaps(job(), items, 0).map((g) => g.text)).toEqual([
      'Checklist not done: Label both ends',
      'Not answered: How many drops tested?',
      'Not signed: Manager signature',
      "Couldn't be done: Cable test results (Tester broke)",
      'Deliverable not done: Work area cleaned up',
      'No customer signature: Manager not on site',
      'No photos of the work',
      'No notes from the tech on what was done',
    ]);
  });

  it('is empty when everything was done, and asks only for what the office asked for', () => {
    const done = job({
      wo_tasks: [{ id: 't1', label: 'Pull 12 drops', completed: true }],
      custom_qa: [{ id: 'q1', label: 'Serial number?', type: 'text', answer: 'SN-1' }],
      closeout: { done: items, signoff: { name: 'Pat', signed_at: '2026-10-18T15:00:00Z' } },
      closeout_notes: 'Ran and tested 12 drops.',
    });
    expect(jobGaps(done, items, 3)).toEqual([]);
    // No signature or photos asked for: none missing, even with none taken.
    const plain = job({ wo_tasks: [], custom_qa: [], closeout: { done: [] }, signature_required: false, photo_required: false, closeout_notes: 'Done.' });
    expect(jobGaps(plain, [], 0)).toEqual([]);
  });
});
