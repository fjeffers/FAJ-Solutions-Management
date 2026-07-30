import { describe, it, expect } from 'vitest';
import {
  siteReportCSV, siteReportTotals, groupBySite, csvCell, fmtDay, fmtSessions, clientSafeNotes, clientVisibleNote,
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

describe('clientSafeNotes', () => {
  // A real Wendy's visit carried the whole import email into notes, including
  // NetView's internal Smartsheet form and a Google Drive deliverables folder.
  const realEmail = `Frederick,

Here are their plans for this location

You are scheduled for the following assignment.
Check Out: https://app.smartsheet.com/b/form/019dc57e81267f29af8cdb73440952f3
Bridge : https://bit.ly/Netview-Bridge
Deliverable https://drive.google.com/drive/folders/1cVTGCIKD7p2Psfa6bStVkvM9XOgmenNx?usp=sharing
Questions: dispatch@netview.example.com`;

  it('strips every internal link so a client report cannot leak them', () => {
    const out = clientSafeNotes(realEmail);
    expect(out).not.toMatch(/https?:\/\//);
    expect(out).not.toContain('smartsheet');
    expect(out).not.toContain('drive.google');
    expect(out).not.toContain('bit.ly');
  });

  it('strips email addresses', () => {
    expect(clientSafeNotes(realEmail)).not.toContain('@netview.example.com');
    expect(clientSafeNotes('reach me at bob@example.com')).not.toContain('@');
  });

  it('drops an internal salutation that gives away forwarded mail', () => {
    expect(clientSafeNotes(realEmail).startsWith('Frederick')).toBe(false);
  });

  it('leaves a genuine work description alone', () => {
    const real = 'Kiosk 2 - faceplate shows B9 and B10. This faceplate should be B10 GREEN and B11 VIOLET.';
    expect(clientSafeNotes(real)).toBe(real);
    expect(clientSafeNotes('Add BLANKS to Rack')).toBe('Add BLANKS to Rack');
  });

  it('truncates anything email-length', () => {
    const out = clientSafeNotes('x'.repeat(2000));
    expect(out.length).toBeLessThanOrEqual(601);
    expect(out.endsWith('…')).toBe(true);
  });

  it('is empty for empty input', () => {
    expect(clientSafeNotes(null)).toBe('');
    expect(clientSafeNotes('   ')).toBe('');
  });

  it('keeps the CSV free of internal links too — the spreadsheet gets shared', () => {
    const csv = siteReportCSV([v({ notes: realEmail })]);
    expect(csv).not.toMatch(/https?:\/\//);
    expect(csv).not.toContain('drive.google');
  });
});

describe('clientVisibleNote', () => {
  const emailDump = `Frederick,

You are scheduled for the following assignment.
Please review each document to be familiar on what is expected and what are the
Required deliverables. Please note there is a Fillable Check list attached that
must be filled out and submitted with the deliverables. Please ensure that you
take a photo of the BOM then Check Mark each item received when doing your
inventory. We will need a photo of the Check Marked BOM added into your
deliverables. Brand : Wendy's Date : 7/16/2026 Address : 388 Highway Route 35.
Matawan, NJ 07735 FLN Number: FLN4783 Scope : Standardization Project`;

  it('prefers a written client summary over notes', () => {
    expect(clientVisibleNote({ notes: emailDump, client_summary: 'Installed 12 drops and terminated the rack.' }))
      .toBe('Installed 12 drops and terminated the rack.');
  });

  it('hides an imported email rather than truncating it into tech instructions', () => {
    expect(clientVisibleNote({ notes: emailDump, client_summary: null })).toBe('');
  });

  it('still shows genuine short notes', () => {
    expect(clientVisibleNote({ notes: 'Add BLANKS to Rack', client_summary: null })).toBe('Add BLANKS to Rack');
    const faceplates = 'Kiosk 2 - faceplate shows B9 and B10. This faceplate should be B10 GREEN and B11 VIOLET. Faceplates B16, A37, A38 have BLUE jacks; change to YELLOW.';
    expect(clientVisibleNote({ notes: faceplates, client_summary: null })).toBe(faceplates);
  });

  it('still strips links from a hand-written summary', () => {
    expect(clientVisibleNote({ notes: null, client_summary: 'Done — see https://internal.example.com/x' }))
      .not.toMatch(/https?:\/\//);
  });

  it('is empty when there is nothing to show', () => {
    expect(clientVisibleNote({ notes: null, client_summary: null })).toBe('');
  });

  it('keeps the shared spreadsheet consistent with the web report', () => {
    const csv = siteReportCSV([v({ notes: emailDump, client_summary: null })]);
    expect(csv).not.toContain('BOM');
    expect(csv).not.toContain('FLN4783');
  });
});
