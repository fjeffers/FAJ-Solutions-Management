import { describe, it, expect } from 'vitest';
import {
  nextSurveyNumber, scopeLineTotal, surveyLabor, surveyTotals,
  scopeItemToQuoteLine, quoteFromSurvey, surveyStage,
  renumberCameras, moveCamera, addCamera, removeCamera, cameraCounts,
  cameraToQuoteLine, documentKindFor, isImageDocument, formatFileSize,
} from './surveys';
import type { Survey, SurveyCamera, SurveyScopeItem } from './types';

const scope = (over: Partial<SurveyScopeItem> = {}): SurveyScopeItem =>
  ({ id: 'sc1', description: 'Dome camera', quantity: 1, unit: null, rate: 0, notes: null, ...over });

const survey = (over: Partial<Survey> = {}): Survey => ({
  id: 'sv-1', user_id: 'u1', survey_number: 'S-2026-001',
  customer_id: null, client_name: 'New Beginnings', client_email: 'n@example.com', client_phone: null,
  poc_name: null, poc_phone: null,
  site_name: 'Chester', site_address: '100 Main St', site_city: 'Chester', site_state: 'PA', site_zip: '19013',
  title: null, survey_date: '2026-08-20', surveyed_by: 'Fred', status: 'draft',
  existing_conditions: null, findings: null, recommendations: null, notes: null,
  scope_items: [], labor_rate: null, labor_hours: null, tax_rate: 0, payment_terms: null,
  photos: [], cameras: [], documents: [],
  head_end_notes: null, rack_space: null, switch_notes: null, access_notes: null,
  quote_id: null, work_order_id: null, share_token: null, archived_at: null,
  created_at: '2026-08-20T00:00:00Z', updated_at: '2026-08-20T00:00:00Z',
  ...over,
});

describe('survey numbering', () => {
  const now = new Date('2026-05-01T12:00:00Z');

  it('starts a fresh year at 001', () => {
    expect(nextSurveyNumber([], now)).toBe('S-2026-001');
  });

  it('continues the highest number in the current year', () => {
    const existing = [{ survey_number: 'S-2026-001' }, { survey_number: 'S-2026-007' }, { survey_number: 'S-2026-003' }];
    expect(nextSurveyNumber(existing, now)).toBe('S-2026-008');
  });

  it('ignores other years and malformed numbers', () => {
    const existing = [{ survey_number: 'S-2025-042' }, { survey_number: 'S-2026-oops' }, { survey_number: '' }];
    expect(nextSurveyNumber(existing, now)).toBe('S-2026-001');
  });
});

describe('survey money', () => {
  it('prices a scope line as qty x rate', () => {
    expect(scopeLineTotal(scope({ quantity: 7, rate: 245 }))).toBe(1715);
  });

  it('treats missing numbers as zero rather than NaN', () => {
    expect(scopeLineTotal({ quantity: NaN, rate: 100 })).toBe(0);
    expect(surveyLabor({ labor_hours: null, labor_rate: 85 })).toBe(0);
  });

  it('prices labour as hours x rate', () => {
    expect(surveyLabor({ labor_hours: 16, labor_rate: 85 })).toBe(1360);
  });

  it('totals scope + labour and applies tax to the subtotal', () => {
    const s = survey({
      scope_items: [scope({ quantity: 7, rate: 245 }), scope({ id: 'sc2', quantity: 1, rate: 300 })],
      labor_hours: 16, labor_rate: 85, tax_rate: 6,
    });
    const t = surveyTotals(s);
    expect(t.scope).toBe(1715 + 300);
    expect(t.labor).toBe(1360);
    expect(t.subtotal).toBe(3375);
    expect(t.tax).toBeCloseTo(202.5, 2);
    expect(t.total).toBeCloseTo(3577.5, 2);
  });

  it('a survey with nothing on it is worth nothing, not NaN', () => {
    const t = surveyTotals(survey());
    expect(t.subtotal).toBe(0);
    expect(t.total).toBe(0);
  });
});

describe('scope line → quote line', () => {
  it('carries qty and rate straight across', () => {
    const line = scopeItemToQuoteLine(scope({ quantity: 7, rate: 245 }));
    expect(line.quantity).toBe(7);
    expect(line.rate).toBe(245);
  });

  it('folds unit and notes into the description so nothing is lost', () => {
    const line = scopeItemToQuoteLine(scope({ description: 'Dome camera', unit: 'ea', notes: 'existing conduit reusable' }));
    expect(line.description).toBe('Dome camera (existing conduit reusable) [ea]');
  });

  it('leaves a plain line plain', () => {
    expect(scopeItemToQuoteLine(scope({ description: 'Dome camera' })).description).toBe('Dome camera');
  });
});

describe('quote built from a survey', () => {
  const s = survey({
    scope_items: [scope({ description: 'Dome camera', quantity: 7, rate: 245, unit: 'ea' })],
    labor_hours: 16, labor_rate: 85, tax_rate: 0,
    recommendations: 'Replace all seven cameras.',
    payment_terms: '50% deposit, 50% on completion',
  });

  it('links back to the survey it came from', () => {
    expect(quoteFromSurvey(s, 'Q-2026-014').survey_id).toBe('sv-1');
    expect(quoteFromSurvey(s, 'Q-2026-014').quote_number).toBe('Q-2026-014');
  });

  it('adds labour as its own visible line', () => {
    const lines = quoteFromSurvey(s, 'Q-1').line_items!;
    expect(lines).toHaveLength(2);
    expect(lines[1].description).toBe('Labor — 16 hrs @ $85/hr');
    expect(lines[1].quantity).toBe(16);
    expect(lines[1].rate).toBe(85);
  });

  it('omits the labour line when no labour was priced', () => {
    const lines = quoteFromSurvey(survey({ scope_items: [scope({ quantity: 1, rate: 10 })] }), 'Q-1').line_items!;
    expect(lines).toHaveLength(1);
  });

  it('quote total matches the survey total', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.total).toBe(surveyTotals(s).total);
    expect(q.total).toBe(1715 + 1360);
  });

  it('starts as a draft and carries the payment terms into the notes', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.status).toBe('draft');
    expect(q.notes).toContain('50% deposit, 50% on completion');
  });

  it('carries the client and site through', () => {
    const q = quoteFromSurvey(s, 'Q-1');
    expect(q.client_name).toBe('New Beginnings');
    expect(q.description).toContain('Chester, PA');
  });
});

describe('pipeline stage', () => {
  it('walks survey → quoted → job', () => {
    expect(surveyStage({ status: 'draft', quote_id: null, work_order_id: null })).toBe('survey');
    expect(surveyStage({ status: 'quoted', quote_id: 'q1', work_order_id: null })).toBe('quoted');
    expect(surveyStage({ status: 'won', quote_id: 'q1', work_order_id: 'w1' })).toBe('job');
  });

  it('a lost survey reads lost no matter what it produced', () => {
    expect(surveyStage({ status: 'lost', quote_id: 'q1', work_order_id: null })).toBe('lost');
  });
});

// ── Camera schedule (migration-068) ─────────────────────────────────────────

const cam = (over: Partial<SurveyCamera> = {}): SurveyCamera => ({
  id: 'c1', position: 1, location: 'Lobby', camera_type: 'Dome', variant: null,
  placement: 'Indoor', mount: 'Ceiling', cable_run: '<50 ft', mount_height_ft: null,
  resolution: '4MP', status: 'New', notes: null, photos: [], ...over,
});

describe('camera schedule numbering', () => {
  it('numbers a fresh list 1..n', () => {
    const list = renumberCameras([
      cam({ id: 'a', position: 9 }), cam({ id: 'b', position: 3 }), cam({ id: 'c', position: 7 }),
    ]);
    expect(list.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it('adding a camera appends it at the next number', () => {
    const list = addCamera([cam({ id: 'a' })]);
    expect(list).toHaveLength(2);
    expect(list[1].position).toBe(2);
  });

  it('removing a camera shifts everything below it up', () => {
    const list = removeCamera(
      [cam({ id: 'a' }), cam({ id: 'b', position: 2 }), cam({ id: 'c', position: 3 })],
      'a',
    );
    expect(list.map((c) => c.id)).toEqual(['b', 'c']);
    expect(list.map((c) => c.position)).toEqual([1, 2]);
  });

  it('moving the network room to the top shifts everything else down', () => {
    // The real case: head-end dome becomes Camera 1 and the rest slide down.
    const before = [
      cam({ id: 'lobby', position: 1, location: 'Lobby' }),
      cam({ id: 'door', position: 2, location: 'Front door' }),
      cam({ id: 'netroom', position: 3, location: 'Network room' }),
    ];
    let after = moveCamera(before, 'netroom', -1);
    after = moveCamera(after, 'netroom', -1);
    expect(after.map((c) => c.location)).toEqual(['Network room', 'Lobby', 'Front door']);
    expect(after.map((c) => c.position)).toEqual([1, 2, 3]);
  });

  it('will not move the first camera up or the last one down', () => {
    const list = [cam({ id: 'a' }), cam({ id: 'b', position: 2 })];
    expect(moveCamera(list, 'a', -1)).toBe(list);
    expect(moveCamera(list, 'b', 1)).toBe(list);
  });
});

describe('camera counts', () => {
  it('totals what the switch and materials are sized from', () => {
    const c = cameraCounts([
      cam({ id: '1', placement: 'Indoor',  status: 'New' }),
      cam({ id: '2', placement: 'Outdoor', status: 'New' }),
      cam({ id: '3', placement: 'Indoor',  status: 'Replace' }),
      cam({ id: '4', placement: 'Indoor',  status: 'Existing' }),
    ]);
    expect(c.total).toBe(4);
    expect(c.indoor).toBe(3);
    expect(c.outdoor).toBe(1);
    expect(c.newCams).toBe(2);
    expect(c.replace).toBe(1);
    expect(c.existing).toBe(1);
    // Existing cameras left in place need no new PoE port.
    expect(c.poePorts).toBe(3);
  });

  it('counts cable runs still marked TBD', () => {
    const c = cameraCounts([
      cam({ id: '1', cable_run: 'TBD' }),
      cam({ id: '2', cable_run: 'tbd' }),
      cam({ id: '3', cable_run: '  ' }),
      cam({ id: '4', cable_run: '<50 ft' }),
    ]);
    expect(c.runsUnknown).toBe(3);
  });

  it('is all zeros for an empty schedule', () => {
    expect(cameraCounts([]).total).toBe(0);
    expect(cameraCounts([]).poePorts).toBe(0);
  });
});

describe('camera to quote line', () => {
  it('reads the way the job is described out loud', () => {
    const line = cameraToQuoteLine(cam({
      position: 1, location: 'Network room', camera_type: 'Dome',
      mount: 'Ceiling', resolution: 'TBD', cable_run: '25 ft',
    }));
    expect(line.description).toBe('Camera 1 — Network room · Dome, ceiling mount · 25 ft cable');
  });

  it('includes the cover when one was specified', () => {
    const line = cameraToQuoteLine(cam({
      position: 2, location: 'Inside office hallway', camera_type: 'Dome',
      mount: 'Ceiling', variant: 'Tinted cover', resolution: 'TBD', cable_run: '30 ft',
    }));
    expect(line.description)
      .toBe('Camera 2 — Inside office hallway · Dome, ceiling mount, tinted cover · 30 ft cable');
  });

  it('flags an outdoor camera and keeps a known resolution', () => {
    const line = cameraToQuoteLine(cam({
      position: 4, location: 'Front entrance', camera_type: 'PTZ',
      mount: 'Wall', placement: 'Outdoor', resolution: '8MP (4K)', cable_run: '<50 ft',
    }));
    expect(line.description)
      .toBe('Camera 4 — Front entrance · PTZ, wall mount, 8MP (4K), outdoor · <50 ft cable');
  });

  it('leaves a TBD cable run off a document the client reads', () => {
    const line = cameraToQuoteLine(cam({ position: 5, location: 'Hallway', resolution: 'TBD', cable_run: 'TBD' }));
    expect(line.description).toBe('Camera 5 — Hallway · Dome, ceiling mount');
  });

  it('falls back to the number when no location was written down', () => {
    expect(cameraToQuoteLine(cam({ position: 2, location: '  ', resolution: 'TBD', cable_run: 'TBD' })).description)
      .toBe('Camera 2 — Camera 2 · Dome, ceiling mount');
  });
});

describe('documentation', () => {
  it('recognises images as photos', () => {
    expect(documentKindFor('IMG_2043.jpg', 'image/jpeg')).toBe('photo');
  });

  it('recognises plans, spec sheets and vendor quotes by name', () => {
    expect(documentKindFor('Chester-floorplan.pdf', 'application/pdf')).toBe('plan');
    expect(documentKindFor('axis-p3245-datasheet.pdf', 'application/pdf')).toBe('spec');
    expect(documentKindFor('ADI-quote-8821.pdf', 'application/pdf')).toBe('quote');
    expect(documentKindFor('notes.txt', 'text/plain')).toBe('other');
  });

  it('treats an image url as viewable even if the kind says otherwise', () => {
    expect(isImageDocument({ kind: 'plan', url: 'https://x/plan.png' })).toBe(true);
    expect(isImageDocument({ kind: 'spec', url: 'https://x/sheet.pdf' })).toBe(false);
  });

  it('formats file sizes readably', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(2_516_582)).toBe('2.4 MB');
    expect(formatFileSize(null)).toBe('');
  });
});

describe('cameras reach the quote', () => {
  it('puts the camera schedule at the top of the quote, in position order', () => {
    const s = survey({
      cameras: [
        cam({ id: 'b', position: 2, location: 'Lobby', mount: 'Ceiling', resolution: 'TBD', cable_run: '<50 ft' }),
        cam({ id: 'a', position: 1, location: 'Network room', mount: 'Ceiling', resolution: 'TBD', cable_run: '25 ft' }),
      ],
      scope_items: [scope({ description: 'Cat6 box', quantity: 2, rate: 180 })],
      labor_hours: 8, labor_rate: 85,
    });
    const lines = quoteFromSurvey(s, 'Q-1').line_items!;
    expect(lines[0].description).toBe('Camera 1 — Network room · Dome, ceiling mount · 25 ft cable');
    expect(lines[1].description).toBe('Camera 2 — Lobby · Dome, ceiling mount · <50 ft cable');
    expect(lines[2].description).toBe('Cat6 box');
    expect(lines[3].description).toContain('Labor');
  });

  it('leaves camera lines unpriced so the rate is set on the quote', () => {
    const s = survey({ cameras: [cam({ id: 'a', position: 1 })] });
    expect(quoteFromSurvey(s, 'Q-1').line_items![0].rate).toBe(0);
  });

  it('carries head-end findings into the quote description', () => {
    const s = survey({ recommendations: 'Replace all seven.', head_end_notes: 'Existing open-frame rack with patch panel' });
    expect(quoteFromSurvey(s, 'Q-1').description).toContain('Existing open-frame rack');
  });

  it('a survey with no cameras still builds the same quote as before', () => {
    const s = survey({ scope_items: [scope({ quantity: 1, rate: 100 })] });
    expect(quoteFromSurvey(s, 'Q-1').line_items).toHaveLength(1);
  });
});
