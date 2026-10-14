import { describe, it, expect } from 'vitest';
import { alertMessage, recipientsFor, toE164, canOpenApp, alertEmailHtml, OWNER_ALERT_EMAIL, type AlertRow } from './project-alerts';

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
