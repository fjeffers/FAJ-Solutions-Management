import { describe, it, expect } from 'vitest';
import { splitPastedEmail, parseGenericEmail, parsePastedEmail } from './pasted';
import { GO_BACK_LIST, GO_BACK_SITE_IDS } from './go-back-list.fixture';

describe('splitPastedEmail', () => {
  it('reads an Outlook forward block', () => {
    const e = splitPastedEmail(`From: Netview Dispatch <automation@app.smartsheet.com>
Sent: Wednesday, July 16, 2026 9:04 AM
To: Frederick Johnson
Subject: NETVIEW DISPATCH FOR Wend American Group - Site: 9531 on 07/16/26

You have a dispatch schedule for 07/16/26`);
    expect(e.sender).toBe('automation@app.smartsheet.com');
    expect(e.subject).toContain('NETVIEW DISPATCH');
    expect(e.body).toBe('You have a dispatch schedule for 07/16/26');
  });

  it('strips a Gmail forward banner and still finds the real headers', () => {
    const e = splitPastedEmail(`---------- Forwarded message ---------
From: Dispatch <dispatch@example.com>
Date: Wed, Jul 16, 2026
Subject: Site visit needed
To: <fajsolutions@gmail.com>

Please attend site 4412.`);
    expect(e.sender).toBe('dispatch@example.com');
    expect(e.subject).toBe('Site visit needed');
    expect(e.body).toBe('Please attend site 4412.');
  });

  it('takes a bare address with no display name', () => {
    expect(splitPastedEmail('From: dispatch@example.com\nSubject: x\n\nbody').sender)
      .toBe('dispatch@example.com');
  });

  it('treats a headerless paste as body, using the first line as the subject', () => {
    const e = splitPastedEmail('Rack install at Bellmawr\nNeeds two techs.');
    expect(e.subject).toBe('Rack install at Bellmawr');
    expect(e.body).toContain('Needs two techs.');
    expect(e.sender).toBe('');
  });

  it('is empty for an empty paste', () => {
    expect(splitPastedEmail('')).toEqual({ sender: '', subject: '', body: '' });
    expect(splitPastedEmail('   \n  ')).toEqual({ sender: '', subject: '', body: '' });
  });
});

describe('parseGenericEmail', () => {
  // Shaped like the real assignment email Fred receives.
  const email = {
    sender: 'dispatch@netview.example.com',
    subject: "Wendy's Standardization — Matawan",
    body: `Brand : Wendy's
Date :  7/16/2026
Address : 388 Highway Route 35. Matawan, NJ 07735
Site ID: 3255
FLN Number: FLN4783
Scope :  Wendy's New Jersey and Philly Standardization Project`,
  };

  it('pulls the labelled fields a dispatch email actually carries', () => {
    expect(parseGenericEmail(email)).toMatchObject({
      customer_name: "Wendy's",
      client_reference: '3255',
      external_wo_id: 'FLN4783',
      start_date: '2026-07-16',
    });
  });

  it('uses the subject as the title — a human wrote it', () => {
    expect(parseGenericEmail(email).title).toBe("Wendy's Standardization — Matawan");
  });

  it('puts the address in its own field and the scope in the description', () => {
    const f = parseGenericEmail(email);
    // The address gets a real field so it can reach work_orders.site_address
    // and the site visit, instead of being buried in prose.
    expect(f.site_address).toBe('388 Highway Route 35. Matawan, NJ 07735');
    expect(f).toMatchObject({ city: 'Matawan', state: 'NJ', zip: '07735' });
    expect(f.description).toContain('Standardization Project');
  });

  it('reads a written-out date when there is no numeric one', () => {
    expect(parseGenericEmail({ sender: '', subject: 'Visit', body: 'Scheduled for August 3, 2026.' }).start_date)
      .toBe('2026-08-03');
  });

  it('leaves fields blank rather than guessing', () => {
    const f = parseGenericEmail({ sender: '', subject: 'Something came up', body: 'Call me.' });
    expect(f.customer_name).toBe('');
    expect(f.client_reference).toBe('');
    expect(f.external_wo_id).toBe('');
    expect(f.start_date).toBeNull();
    expect(f.title).toBe('Something came up');
  });

  it('handles the ticket label in its other spellings', () => {
    expect(parseGenericEmail({ sender: '', subject: '', body: 'Ticket Number: 88231' }).external_wo_id).toBe('88231');
    expect(parseGenericEmail({ sender: '', subject: '', body: 'Work Order #: WO-5512' }).external_wo_id).toBe('WO-5512');
  });
});

describe('parsePastedEmail', () => {
  it('routes a real Netview dispatch to the Netview parser', () => {
    const out = parsePastedEmail(`From: automation@app.smartsheet.com
Subject: NETVIEW DISPATCH FOR Wend American Group - Site:  9531 on 07/01/26

You have a dispatch schedule for 07/01/26 at Wend American Group in PHILADELPHIA PA
Site ID:  9531
Ticket Number:  FLN5092
Scope:
Adding one new camera to the Training Room
CONFIRM YOUR VISIT by opening the request`);
    expect(out?.matched).toBe('netview');
    expect(out?.fields).toMatchObject({
      customer_name: "Wendy's", client_reference: '9531',
      external_wo_id: 'FLN5092', start_date: '2026-07-01',
    });
  });

  it('falls back to generic for an email no parser recognises', () => {
    const out = parsePastedEmail('Subject: Rack move\n\nSite ID: 771\nDate : 9/2/2026');
    expect(out?.matched).toBe('generic');
    expect(out?.fields).toMatchObject({ client_reference: '771', start_date: '2026-09-02' });
  });

  it('returns null only for an empty paste', () => {
    expect(parsePastedEmail('')).toBeNull();
    expect(parsePastedEmail('   ')).toBeNull();
  });
});

// ── The real thing: one email, many work orders ──────────────────────────────
describe('multi-site go-back list (real NetView email, 2026-07-28)', () => {
  const out = parsePastedEmail(GO_BACK_LIST)!;

  it('finds all 18 sites, not one job for the whole email', () => {
    expect(out.jobs).toHaveLength(18);
  });

  it('reads every site number through every separator variant Karen typed', () => {
    // "Site ID 1331", "Site ID  452", "Site ID: 9291", "Site ID : 11503"
    expect(out.jobs.map((j) => j.client_reference)).toEqual(GO_BACK_SITE_IDS);
  });

  it('gives every job a distinct site number — none merge or duplicate', () => {
    expect(new Set(out.jobs.map((j) => j.client_reference)).size).toBe(18);
  });

  it('titles each job by its site name and number', () => {
    expect(out.jobs.map((j) => j.title).slice(0, 4))
      .toEqual(['Hillside #1331', 'BAYONNE #8349', 'WEST DEPTFORD #8526', 'ARAMINGO #452']);
    // including the awkward "Site Name  :City Ave Center" (no space after colon)
    expect(out.jobs.find((j) => j.client_reference === '945')?.title)
      .toBe('City Ave Center #945');
  });

  it('gives every job a name and an address — nothing silently blank', () => {
    for (const j of out.jobs) {
      expect(j.site_name, `site ${j.client_reference} name`).toBeTruthy();
      expect(j.site_address, `site ${j.client_reference} address`).toBeTruthy();
    }
  });

  it('captures the street address, including the "Site Address :" variant', () => {
    expect(out.jobs[0].site_address).toBe('410 Route 221 Hillside, NJ 07205');
    expect(out.jobs.find((j) => j.client_reference === '2445')?.site_address)
      .toBe('501 ADAMS AVENUE.  PHILADELPHIA, PA 19120');
    expect(out.jobs.find((j) => j.client_reference === '9291')?.site_address)
      .toBe('320 Village Center Dr.  Swedesboro, NJ 08085');
  });

  it('splits city and state out of the address', () => {
    expect(out.jobs[0]).toMatchObject({ city: 'Hillside', state: 'NJ', zip: '07205' });
    expect(out.jobs.find((j) => j.client_reference === '452'))
      .toMatchObject({ city: 'Philadelphia', state: 'PA', zip: '19134' });
    expect(out.jobs.find((j) => j.client_reference === '11503'))
      .toMatchObject({ city: 'Mt Laurel', state: 'NJ', zip: '08054' });
  });

  it('keeps each site\'s own multi-line scope as its description', () => {
    expect(out.jobs[0].description).toContain('Q-Board and COB are black');
    expect(out.jobs[0].description).toContain('All cameras are showing offline');
    // and does not bleed the next site's scope into it
    expect(out.jobs[0].description).not.toContain('Rack needs to be moved');
    expect(out.jobs.find((j) => j.client_reference === '8526')?.description)
      .toContain('Rack needs to be moved into managers office');
  });

  it('keeps internal Drive links out of the description', () => {
    for (const j of out.jobs) expect(j.description).not.toMatch(/https?:\/\//);
  });

  it('takes the customer from the subject so all 5 land on one client', () => {
    expect(new Set(out.jobs.map((j) => j.customer_name))).toEqual(new Set(['Wendys']));
  });

  it('does not leak the shared preamble into a job as if it were scope', () => {
    expect(out.jobs[0].description).not.toContain('remaining sites that need');
  });
});
