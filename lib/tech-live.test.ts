import { describe, expect, it } from 'vitest';
import { jobChanges } from './tech-live';
import { wfJobFromTech } from './wf';

const job = (over: Record<string, unknown> = {}) => wfJobFromTech({
  id: 'a', wo_number: '19101392', wo_status: 'Assigned', my_response: 'accepted', customer_name: 'Media Co',
  start_date: '2026-10-09', start_time: '14:00', end_time: '21:00',
  site_address: '1 Main St', site_city: 'Howell', scope_of_work: 'Mount 6 displays', ...over,
});

describe('jobChanges', () => {
  it('says nothing when nothing changed', () => {
    expect(jobChanges([job()], [job()])).toEqual([]);
  });

  it('reports a new time in plain 12-hour words', () => {
    const out = jobChanges([job()], [job({ start_time: '10:00', end_time: '17:00' })]);
    expect(out).toEqual([{ number: '19101392', kind: 'time', text: 'WO 19101392: new time 10:00 AM – 5:00 PM' }]);
  });

  it('reports a new date once, not a date and a time', () => {
    const out = jobChanges([job()], [job({ start_date: '2026-10-16', scheduled_date: '2026-10-16', start_time: '10:00' })]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('WO 19101392: new date Fri Oct 16, 10:00 AM');
  });

  it('reports new documents, address, scope and access changes', () => {
    const out = jobChanges(
      [job()],
      [job({ site_address: '9 Oak Ave', scope_of_work: 'Mount 8 displays', access_instructions: 'Lockbox 1234' })],
      { '19101392': 2 }, { '19101392': 4 },
    ).map((c) => c.text);
    expect(out).toContain('WO 19101392: new address 9 Oak Ave, Howell');
    expect(out).toContain('WO 19101392: the scope of work was updated');
    expect(out).toContain('WO 19101392: 2 new documents were added');
  });

  it('announces a new job and one that left the list', () => {
    const other = job({ id: 'b', wo_number: '555', customer_name: 'Wendy\'s' });
    expect(jobChanges([job()], [job(), other]).map((c) => c.text)).toEqual(["New job: WO 555 · Wendy's"]);
    expect(jobChanges([job(), other], [job()]).map((c) => c.text)).toEqual(['WO 555 is no longer on your list']);
  });

  it('never mentions who made the change', () => {
    const out = jobChanges([job()], [job({ start_time: '09:00', site_address: '2 Elm', scope_of_work: 'x' })], {}, { '19101392': 1 });
    for (const c of out) expect(c.text).not.toMatch(/office|admin|fred/i);
  });
});
