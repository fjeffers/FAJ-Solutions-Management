import { describe, it, expect } from 'vitest';
import { alertMessage, recipientsFor, recipientsForAlert, toE164, canOpenApp, alertEmailHtml, OWNER_ALERT_EMAIL, type AlertRow, type AlertPerson } from './project-alerts';

const base: AlertRow = {
  id: 'a1', user_id: 'owner', wo_id: 'w1', wo_number: 'TEST-PRJ-1', project_name: 'TEST Mock Project',
  kind: 'day_start', tech: 'Frederick Jeffers', at: '2026-10-13T10:45:00Z', detail: {},
};
const job = { title: 'Mock site', site: 'TEST Rockingham meetinghouse', city: 'Rockingham', state: 'NC' };

describe('alertMessage', () => {
  it('says who, what, where and when', () => {
    const m = alertMessage(base, job);
    expect(m.title).toBe('Frederick Jeffers clocked in');
    expect(m.where).toBe('TEST Rockingham meetinghouse (Rockingham, NC) · WO TEST-PRJ-1 · 6:45 AM');
  });
  it('travel, arriving with miles, signing out', () => {
    expect(alertMessage({ ...base, kind: 'travel_start', detail: { dest: 'site' } }, job).title).toBe('Frederick Jeffers is driving to the site');
    const arr = alertMessage({ ...base, kind: 'travel_end', detail: { dest: 'site', miles: 42.4 } }, job);
    expect(arr.title).toBe('Frederick Jeffers arrived at the site');
    expect(arr.lines).toEqual(['About 42.4 miles']);
    expect(alertMessage({ ...base, kind: 'sign_out', detail: { dest: 'hotel' } }, job).title).toBe('Frederick Jeffers signed out (arrived at the hotel)');
  });
  it('site finished lists the reasons', () => {
    const m = alertMessage({ ...base, kind: 'site_finished', detail: { skipped: { 'Roof photo': 'No ladder access' }, sign_skip: { reason: 'Contact not on site' } } }, job);
    expect(m.title).toBe('Frederick Jeffers finished the site');
    expect(m.lines).toEqual(['No signature: Contact not on site', 'Couldn\'t do "Roof photo": No ladder access']);
  });
  it('photos, receipts, notes and answers', () => {
    const p = alertMessage({ ...base, kind: 'photos', detail: { count: 3, urls: ['https://x/1.jpg', 'javascript:alert(1)', 'https://x/2.jpg'] } }, job);
    expect(p.title).toBe('3 new photos from Frederick Jeffers');
    expect(p.photos).toEqual(['https://x/1.jpg', 'https://x/2.jpg']);
    expect(alertMessage({ ...base, kind: 'receipt', detail: { category: 'fuel', amount: 48.2, vendor: 'Wawa' } }, job).title)
      .toBe('Frederick Jeffers added a fuel receipt: $48.20');
    expect(alertMessage({ ...base, kind: 'notes', detail: { notes: 'Ran 13 drops' } }, job).lines).toEqual(['Ran 13 drops']);
    expect(alertMessage({ ...base, kind: 'answers', detail: { answers: [{ q: 'Rack size?', a: '12U' }] } }, job).lines).toEqual(['Rack size?: 12U']);
  });
  it('no job details still reads', () => {
    expect(alertMessage({ ...base, tech: null }, null).title).toBe('A tech clocked in');
  });
});

describe('who gets it', () => {
  it('the owner alone while the project has no list', () => {
    const r = recipientsFor([], 'owner');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ role: 'owner', email: OWNER_ALERT_EMAIL, auth_user_id: 'owner', by_push: true, by_email: true });
  });
  it('the list as set, and only office logins get an app link', () => {
    const pm = { name: 'Mike', role: 'pm' as const, email: 'm@x.com', phone: null, auth_user_id: null, by_email: true, by_push: false, by_text: false };
    expect(recipientsFor([pm], 'owner')).toEqual([pm]);
    expect(canOpenApp(pm)).toBe(false);
    expect(canOpenApp({ ...pm, role: 'assistant' })).toBe(true);
  });
  it('phone numbers for texts', () => {
    expect(toE164('(484) 867-7191')).toBe('+14848677191');
    expect(toE164('1 484 867 7191')).toBe('+14848677191');
    expect(toE164('867-7191')).toBeNull();
  });
});

describe('email', () => {
  it('escapes what the tech typed and links only when given', () => {
    const html = alertEmailHtml('P', { title: '<b>x</b>', where: 'w', lines: ['a & b'], photos: [] }, null);
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).not.toContain('Open the job');
  });
});

describe('sheet messages (migration 121)', () => {
  const base: AlertRow = { id: 'a', user_id: 'owner', wo_id: 'w', wo_number: '4454', project_name: 'P', kind: 'issue', tech: 'Mike', at: '2026-10-14T11:52:00Z', detail: {} };
  const person = (name: string, role: AlertPerson['role']): AlertPerson => ({ name, role, email: `${name}@x.com`, phone: null, auth_user_id: null, by_email: true, by_push: false, by_text: false });
  const people = [person('You', 'owner'), person('Dana', 'pm'), person('Lee', 'pm'), person('Ann', 'assistant')];

  it('No access: says why and that the clock is running', () => {
    const m = alertMessage({ ...base, detail: { body: 'No access to the building', reason: 'Box code not working', to: 'Dana' } }, null);
    expect(m.title).toBe('Mike: No access to the building');
    expect(m.lines[0]).toBe('Why: Box code not working');
  });
  it('access granted: how long they waited', () => {
    const m = alertMessage({ ...base, kind: 'resolved', detail: { waited_min: 38 } }, null);
    expect(m.title).toBe('Mike has access now');
    expect(m.lines).toEqual(['Waited 38 min without access']);
  });
  it("a tech's message to Dana goes to Dana and the office, not Lee", () => {
    const to = recipientsForAlert(people, 'owner', { kind: 'issue', detail: { to: 'Dana' } }).map((p) => p.name);
    expect(to.sort()).toEqual(['Ann', 'Dana', 'You']);
  });
  it('a message to everyone goes to the whole list', () => {
    expect(recipientsForAlert(people, 'owner', { kind: 'message', detail: {} })).toHaveLength(4);
  });
  it('missing materials: what is missing, and back to work', () => {
    expect(alertMessage({ ...base, detail: { body: 'Missing materials', reason: '2 boxes of Cat6' } }, null))
      .toMatchObject({ title: 'Mike: Missing materials', lines: ['2 boxes of Cat6', "Stopped until they're back to work. Reply on the live sheet."] });
    expect(alertMessage({ ...base, kind: 'resolved', detail: { body: 'Back to work', waited_min: 25 } }, null))
      .toMatchObject({ title: 'Mike is back to work', lines: ['Waited 25 min stopped'] });
  });
  it('end of day, stepped off, late', () => {
    expect(alertMessage({ ...base, kind: 'report', detail: { body: 'Done today: racks 1-3\nStill to do: patching' } }, null))
      .toMatchObject({ title: "Mike's end-of-day report", lines: ['Done today: racks 1-3', 'Still to do: patching'] });
    expect(alertMessage({ ...base, kind: 'away', detail: { reason: 'Lunch', body: 'Stepped off site' } }, null))
      .toMatchObject({ title: 'Mike stepped off site: Lunch', lines: [] });
    expect(alertMessage({ ...base, kind: 'late', detail: { start: '8:00 AM' } }, null))
      .toMatchObject({ title: 'Mike is not on site yet', lines: ["30 minutes past the 8:00 AM start. They've been asked why."] });
    expect(alertMessage({ ...base, kind: 'late', detail: { reason: 'Traffic', body: 'Running late · there in about 20 min' } }, null).title)
      .toBe('Mike is running late: Traffic');
  });
  it('a message from the sheet goes to the office only (the PM wrote it)', () => {
    const to = recipientsForAlert(people, 'owner', { kind: 'client_message', detail: { to: 'Mike' } }).map((p) => p.name);
    expect(to.sort()).toEqual(['Ann', 'You']);
    expect(recipientsForAlert([person('Dana', 'pm')], 'owner', { kind: 'client_message', detail: {} })[0].email).toBe(OWNER_ALERT_EMAIL);
    expect(alertMessage({ ...base, kind: 'client_message', tech: 'Dana', detail: { kind: 'question', body: 'Different angle?', to: 'Mike' } }, null).title)
      .toBe('Dana asked a question on the live sheet (to Mike)');
  });
});
