import { describe, it, expect } from 'vitest';
import { checkoutFormUrl, clock12, clock24, dateMDY, lastOffOrNow, linkPurpose, onSiteSince, parseSiteLinks, siteIdOf } from './site-links';
import type { DayEvent } from './project-day';

const TZ = 'America/New_York';
const FORM = 'https://app.smartsheet.com/b/form/abc123';
const at = (s: string) => new Date(`${s}-04:00`).toISOString();

describe('the client links for a day on site (Fred, 2026-10-18)', () => {
  it('reads the two links and drops anything that is not a web address', () => {
    expect(parseSiteLinks({ checkin: 'https://teams.microsoft.com/l/meetup-join/x', checkout: FORM })).toEqual({
      checkin: 'https://teams.microsoft.com/l/meetup-join/x', checkout: FORM,
    });
    expect(parseSiteLinks({ checkin: 'javascript:alert(1)', checkout: 42 })).toEqual({});
    expect(parseSiteLinks(null)).toEqual({});
  });

  it('reads the survey and documents links, and says what each link is for (Fred, 2026-10-25)', () => {
    const SURVEY = 'https://survey.ldsqa.fyi/';
    const DRIVE = 'https://drive.google.com/drive/folders/abc';
    const links = parseSiteLinks({ checkout: FORM, survey: SURVEY, deliverable: DRIVE });
    expect(links).toEqual({ checkout: FORM, survey: SURVEY, deliverable: DRIVE });
    expect(linkPurpose(SURVEY, links)).toBe('Fill in the site survey');
    expect(linkPurpose(DRIVE, links)).toBe('Upload the photos and documents here');
    expect(linkPurpose(FORM, links)).toBe('Fill in when you check out each day');
    expect(linkPurpose('https://lds-tools-hub.ldsqa.fyi/', links)).toBeNull();
  });

  it("reads the client's site and ticket numbers", () => {
    expect(parseSiteLinks({ checkout: FORM, site_id: ' 5011876 ', ticket: 'LDS-1110' })).toEqual({ checkout: FORM, siteId: '5011876', ticket: 'LDS-1110' });
    expect(parseSiteLinks({ site_id: '', ticket: 7 })).toEqual({});
  });

  it('finds the site number in a title', () => {
    expect(siteIdOf('LDS-1110-5011876-Gaffney, NC')).toBe('5011876');
    expect(siteIdOf('TEST — LDS-1110-5011876-Gaffney, NC')).toBe('5011876');
    expect(siteIdOf('LDS Site 5011876 — Gaffney, SC (NetView LDS-1110)')).toBe('5011876');
    expect(siteIdOf('Site 5006643 Goldsboro, NC —')).toBe('5006643');
    expect(siteIdOf('Site ID # 5006643')).toBe('5006643');
    expect(siteIdOf('Wendy’s #4411 network')).toBeNull();
    expect(siteIdOf(null)).toBeNull();
  });

  it('writes times and dates the way the LDS form shows them', () => {
    expect(clock24(at('2026-10-19T07:05:00'), TZ)).toBe('07:05');
    expect(clock24(at('2026-10-19T16:30:00'), TZ)).toBe('16:30');
    expect(clock24(at('2026-10-19T00:10:00'), TZ)).toBe('00:10');
    expect(dateMDY(at('2026-10-19T16:30:00'), TZ)).toBe('10/19/2026');
  });

  it('takes the first clock-in on the day the tech leaves', () => {
    const day: DayEvent[] = [
      { kind: 'in', at: at('2026-10-18T09:00:00') },
      { kind: 'in', at: at('2026-10-19T07:32:00') },
      { kind: 'out', at: at('2026-10-19T12:00:00') },
      { kind: 'in', at: at('2026-10-19T12:40:00') },
    ];
    expect(onSiteSince(day, at('2026-10-19T16:30:00'), TZ)).toBe(at('2026-10-19T07:32:00'));
    expect(onSiteSince(day, at('2026-10-20T16:30:00'), TZ)).toBeNull();
  });

  it('fills in the LDS checkout form from the app', () => {
    const url = checkoutFormUrl(FORM, {
      siteId: '5011876', wo: '19101399', name: 'Frederick Jeffers',
      on: at('2026-10-19T07:32:00'), off: at('2026-10-19T16:30:00'), timeZone: TZ,
    });
    // The form's box names and time format as of 2026-10-22 (its formDefinition).
    expect(url).toBe(`${FORM}?Site%20ID=5011876&Work%20Order%20%23=19101399&Checkout%20Date=10%2F19%2F2026`
      + '&Full%20Name=Frederick%20Jeffers&Check%20In%20Time=7%3A32%20am&Check%20Out%20Time=4%3A30%20pm');
  });

  it('writes times the way the form asks: 12-hour with am / pm', () => {
    expect(clock12(at('2026-10-19T00:05:00'), TZ)).toBe('12:05 am');
    expect(clock12(at('2026-10-19T12:00:00'), TZ)).toBe('12:00 pm');
    expect(clock12(at('2026-10-19T19:22:00'), TZ)).toBe('7:22 pm');
  });

  it('leaves out what it does not know, and opens any other form as it is', () => {
    const url = checkoutFormUrl(FORM, { siteId: null, wo: '19101400', name: '', on: null, off: at('2026-10-19T16:30:00'), timeZone: TZ });
    expect(url).toBe(`${FORM}?Work%20Order%20%23=19101400&Checkout%20Date=10%2F19%2F2026&Check%20Out%20Time=4%3A30%20pm`);
    expect(checkoutFormUrl('https://forms.office.com/r/xyz', { siteId: '1', wo: '2', name: 'A', on: null, off: at('2026-10-19T16:30:00'), timeZone: TZ }))
      .toBe('https://forms.office.com/r/xyz');
  });

  it('uses the last time off site today for the form on the job, or now while still on site', () => {
    const day: DayEvent[] = [{ kind: 'in', at: at('2026-10-19T07:30:00') }, { kind: 'out', at: at('2026-10-19T16:30:00') }];
    // 9 PM in New York is already the next day in UTC: still the same day here.
    expect(lastOffOrNow(day, at('2026-10-19T21:00:00'), TZ)).toBe(at('2026-10-19T16:30:00'));
    expect(lastOffOrNow(day.slice(0, 1), at('2026-10-19T12:00:00'), TZ)).toBe(at('2026-10-19T12:00:00'));
    expect(lastOffOrNow(day, at('2026-10-20T08:00:00'), TZ)).toBe(at('2026-10-20T08:00:00'));
  });
});
