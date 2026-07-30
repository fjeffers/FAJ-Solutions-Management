import { describe, it, expect } from 'vitest';
import {
  siteReportCSV, siteReportTotals, groupBySite, csvCell, fmtDay, fmtSessions,
  type ReportVisit,
} from './site-report';

const v = (over: Partial<ReportVisit> = {}): ReportVisit => ({
  visit_date: '2026-07-20',
  site_name: 'Roselle',
  site_code: '5798',
  address: '123 Main St',
  time_in: '2026-07-20T13:00:00Z',
  time_out: '2026-07-20T17:00:00Z',
  hours: 4,
  visit_type: 'T&M',
  notes: 'Pulled 6 drops, terminated patch panel',
  sessions: null,
  ...over,
});

describe('csvCell', () => {
  it('quotes and escapes embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('neutralises formula injection so Excel treats it as text', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe('"\'=SUM(A1:A9)"');
    expect(csvCell('-2 drops')).toBe('"\'-2 drops"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('@handle')).toBe('"\'@handle"');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});

describe('fmtDay', () => {
  it('does not drift across timezones', () => {
    // Parsed at noon on purpose — a bare date string parsed as UTC lands on the
    // previous day in the US and every date in the report shifts.
    expect(fmtDay('2026-07-20')).toBe('Jul 20, 2026');
    expect(fmtDay('2026-01-01')).toBe('Jan 1, 2026');
  });

  it('is empty for missing or unparseable input', () => {
    expect(fmtDay(null)).toBe('');
    expect(fmtDay('not-a-date')).toBe('');
  });
});

describe('siteReportCSV', () => {
  it('writes a header and one row per visit', () => {
    const csv = siteReportCSV([v()]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Work Performed"');
    expect(lines[1]).toContain('Roselle');
    expect(lines[1]).toContain('Pulled 6 drops');
  });

  it('carries no money — this report goes to the client', () => {
    const csv = siteReportCSV([v()]);
    expect(csv).not.toMatch(/rate|amount|\$|total|pay/i);
  });

  it('sorts newest first', () => {
    const csv = siteReportCSV([
      v({ visit_date: '2026-06-01', site_name: 'Older' }),
      v({ visit_date: '2026-07-20', site_name: 'Newer' }),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[1]).toContain('Newer');
    expect(lines[2]).toContain('Older');
  });

  it('produces just a header for no visits', () => {
    expect(siteReportCSV([]).split('\r\n')).toHaveLength(1);
  });
});

describe('fmtSessions', () => {
  it('spells out a multi-day visit', () => {
    const out = fmtSessions([
      { in: '2026-06-04T20:15:00Z', out: '2026-06-04T23:45:00Z' },
      { in: '2026-06-05T10:00:00Z', out: '2026-06-05T13:15:00Z' },
    ] as never);
    expect(out).toContain('Jun 4, 2026');
    expect(out).toContain('Jun 5, 2026');
    expect(out.split(';')).toHaveLength(2);
  });

  it('marks a stint still running as open', () => {
    expect(fmtSessions([{ in: '2026-06-04T20:15:00Z', out: null }] as never)).toContain('open');
  });

  it('is empty when there are no sessions', () => {
    expect(fmtSessions(null)).toBe('');
    expect(fmtSessions([])).toBe('');
  });
});

describe('siteReportTotals', () => {
  it('counts visits, hours, and distinct sites', () => {
    const t = siteReportTotals([
      v({ site_code: '5798', hours: 4, visit_date: '2026-07-20' }),
      v({ site_code: '5798', hours: 2.5, visit_date: '2026-07-22' }),
      v({ site_code: '1062', hours: 3, visit_date: '2026-06-01' }),
    ]);
    expect(t).toMatchObject({ visits: 3, hours: 9.5, sites: 2, firstVisit: '2026-06-01', lastVisit: '2026-07-22' });
  });

  it('handles an empty report without dividing by anything', () => {
    expect(siteReportTotals([])).toMatchObject({ visits: 0, hours: 0, sites: 0, firstVisit: null, lastVisit: null });
  });
});

describe('groupBySite', () => {
  it('stacks every visit to a site under one heading, newest site first', () => {
    const groups = groupBySite([
      v({ site_code: '5798', site_name: 'Roselle', visit_date: '2026-06-01' }),
      v({ site_code: '5798', site_name: 'Roselle', visit_date: '2026-07-22' }),
      v({ site_code: '1062', site_name: 'Bellmawr', visit_date: '2026-07-01' }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].title).toBe('Roselle #5798');
    expect(groups[0].visits).toHaveLength(2);
    expect(groups[0].visits[0].visit_date).toBe('2026-07-22');
    expect(groups[1].title).toBe('Bellmawr #1062');
  });

  it('falls back to the address when a site has no name', () => {
    const groups = groupBySite([v({ site_name: null, site_code: null, address: '9 Elm' })]);
    expect(groups[0].title).toBe('9 Elm');
  });
});
