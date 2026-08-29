import { describe, it, expect } from 'vitest';
import {
  nextSurveyNumber, scopeLineTotal, surveyLabor, surveyTotals,
  scopeItemToQuoteLine, quoteFromSurvey, surveyStage,
  renumberCameras, moveCamera, addCamera, removeCamera, cameraCounts,
  cameraToQuoteLine, documentKindFor, isImageDocument, formatFileSize,
  deviceTotal, unpricedDevices, parseRunFeet, cableEstimate,
  addDrop, removeDrop, moveDrop, dropCounts, dropToQuoteLine,
  placementRows, pageStatus, readyToQuote,
} from './surveys';
import type { CableDrop, Survey, SurveyCamera, SurveyScopeItem } from './types';

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
  photos: [], cameras: [], documents: [], cable_drops: [], custom_qa: [],
  survey_type: 'camera', last_page: 1,
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
  resolution: '4MP', status: 'New', unit_price: 0, origin_point: null,
  pathway_notes: null, materials_needed: null, notes: null, photos: [], ...over,
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

// ── Drop schedule + wizard pages (migration-069) ────────────────────────────

const drop = (over: Partial<CableDrop> = {}): CableDrop => ({
  id: 'd1', position: 1, location: 'Reception desk', jack_count: 2,
  cable_type: 'Cat6', run_length: '85 ft', termination: 'Patch panel A, ports 12-13',
  mount: 'Wall plate', unit_price: 0, origin_point: null,
  pathway_notes: null, materials_needed: null, notes: null, photos: [], ...over,
});

describe('drop schedule', () => {
  it('renumbers on add and remove like the camera schedule does', () => {
    let drops = addDrop([drop({ id: 'a' })]);
    expect(drops.map((d) => d.position)).toEqual([1, 2]);
    drops = removeDrop(drops, 'a');
    expect(drops.map((d) => d.position)).toEqual([1]);
  });

  it('moves a drop and reshuffles the numbering', () => {
    const before = [drop({ id: 'a', location: 'A' }), drop({ id: 'b', position: 2, location: 'B' })];
    const after = moveDrop(before, 'b', -1);
    expect(after.map((d) => d.location)).toEqual(['B', 'A']);
    expect(after.map((d) => d.position)).toEqual([1, 2]);
  });

  it('totals jacks and groups them by cable type', () => {
    const c = dropCounts([
      drop({ id: '1', jack_count: 2, cable_type: 'Cat6' }),
      drop({ id: '2', jack_count: 1, cable_type: 'Cat6' }),
      drop({ id: '3', jack_count: 4, cable_type: 'Cat6A' }),
    ]);
    expect(c.total).toBe(3);
    expect(c.jacks).toBe(7);
    expect(c.byCable[0]).toEqual({ type: 'Cat6A', jacks: 4 });
  });

  it('reads as a numbered line with jacks, cable and termination', () => {
    expect(dropToQuoteLine(drop()).description)
      .toBe('Drop 1 — Reception desk · 2 jacks, Cat6, wall plate · 85 ft run · terminates Patch panel A, ports 12-13');
  });

  it('bills per jack, not per location', () => {
    expect(dropToQuoteLine(drop({ jack_count: 2 }), 125).quantity).toBe(2);
    expect(dropToQuoteLine(drop({ jack_count: 2 }), 125).rate).toBe(125);
  });
});

describe('survey type drives the quote', () => {
  it('a cabling survey quotes drops, not cameras', () => {
    const s = survey({
      survey_type: 'cabling',
      cable_drops: [drop({ id: 'a', position: 1 })],
      cameras: [cam({ id: 'ignored', position: 1, location: 'Should not appear' })],
    });
    const lines = quoteFromSurvey(s, 'Q-1').line_items!;
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toContain('Drop 1');
  });

  it('a general survey quotes only its scope lines', () => {
    const s = survey({
      survey_type: 'general',
      cameras: [cam({ id: 'x', position: 1 })],
      scope_items: [scope({ description: 'Consulting', quantity: 1, rate: 500 })],
    });
    const lines = quoteFromSurvey(s, 'Q-1').line_items!;
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('Consulting');
  });
});

describe('placement rows', () => {
  it('lists cameras for a camera survey', () => {
    const rows = placementRows(survey({
      cameras: [cam({ id: 'a', position: 1, location: 'Lobby', mount: 'Ceiling' })],
    }));
    expect(rows[0].label).toBe('Camera 1');
    expect(rows[0].detail).toBe('Lobby · Dome · ceiling mount');
  });

  it('lists drops for a cabling survey', () => {
    const rows = placementRows(survey({ survey_type: 'cabling', cable_drops: [drop()] }));
    expect(rows[0].label).toBe('Drop 1');
    expect(rows[0].detail).toBe('Reception desk · Cat6 · 2 jacks');
  });

  it('has nothing to place on a general survey', () => {
    expect(placementRows(survey({ survey_type: 'general' }))).toEqual([]);
  });
});

describe('page status', () => {
  const complete = survey({
    client_name: 'New Beginnings', site_name: 'Chester',
    cameras: [cam({ id: 'a', position: 1, location: 'Lobby', cable_run: '25 ft', unit_price: 245, photos: ['u'] })],
    recommendations: 'Replace all seven.', labor_hours: 8, labor_rate: 85,
  });

  it('a fully filled survey has every page clear and is ready to quote', () => {
    expect(pageStatus(complete).every((p) => p.done)).toBe(true);
    expect(readyToQuote(complete)).toBe(true);
  });

  it('names what page 1 is missing', () => {
    const st = pageStatus(survey({ client_name: null, site_name: null, site_address: null }));
    expect(st[0].done).toBe(false);
    expect(st[0].missing).toContain('client name');
  });

  it('flags cameras with no location and runs still TBD', () => {
    const st = pageStatus(survey({
      client_name: 'X', site_name: 'Y',
      cameras: [cam({ id: 'a', position: 1, location: '', cable_run: 'TBD' })],
    }));
    expect(st[1].done).toBe(false);
    expect(st[1].missing.join(' ')).toMatch(/location/);
    expect(st[1].missing.join(' ')).toMatch(/TBD/);
  });

  it('counts placements without a photo but does not block the quote for it', () => {
    const s = { ...complete, cameras: [{ ...complete.cameras[0], photos: [] }] };
    const st = pageStatus(s);
    expect(st[2].done).toBe(false);
    expect(st[2].missing[0]).toBe('1 of 1 without a photo');
    expect(readyToQuote(s)).toBe(true);
  });

  it('will not call a survey ready when nothing is priced at all', () => {
    const s = {
      ...complete,
      labor_hours: null, labor_rate: null, scope_items: [],
      cameras: complete.cameras.map((c) => ({ ...c, unit_price: 0 })),
    };
    expect(readyToQuote(s)).toBe(false);
    expect(pageStatus(s)[3].missing).toContain('a price on something');
  });
});

// ── Device pricing: the $0.00-quote bug ─────────────────────────────────────

describe('device pricing', () => {
  it('totals cameras at one each', () => {
    expect(deviceTotal({
      survey_type: 'camera',
      cameras: [cam({ id: 'a', unit_price: 245 }), cam({ id: 'b', unit_price: 480 })],
    })).toBe(725);
  });

  it('bills drops per jack, not per location', () => {
    // One location, two jacks, $125 a jack = $250.
    expect(deviceTotal({
      survey_type: 'cabling',
      cable_drops: [drop({ id: 'a', jack_count: 2, unit_price: 125 })],
    })).toBe(250);
  });

  it('ignores the schedule that does not belong to the survey type', () => {
    expect(deviceTotal({
      survey_type: 'cabling',
      cameras: [cam({ id: 'x', unit_price: 999 })],
      cable_drops: [],
    })).toBe(0);
  });

  it('counts rows still sitting at zero', () => {
    expect(unpricedDevices({
      survey_type: 'camera',
      cameras: [cam({ id: 'a', unit_price: 245 }), cam({ id: 'b' }), cam({ id: 'c' })],
    })).toBe(2);
  });
});

describe('cameras reach the quote priced', () => {
  const priced = survey({
    cameras: [
      cam({ id: 'a', position: 1, location: 'Network room', unit_price: 245, cable_run: '25 ft', photos: ['u'] }),
      cam({ id: 'b', position: 2, location: 'Hallway', unit_price: 245, cable_run: '30 ft', photos: ['u'] }),
    ],
    labor_hours: 8, labor_rate: 85,
    client_name: 'New Beginnings', site_name: 'Chester', recommendations: 'Replace all.',
  });

  it('the survey total includes the cameras', () => {
    const t = surveyTotals(priced);
    expect(t.devices).toBe(490);
    expect(t.labor).toBe(680);
    expect(t.total).toBe(1170);
  });

  it('each camera line carries its own price, not zero', () => {
    const lines = quoteFromSurvey(priced, 'Q-1').line_items!;
    expect(lines[0].rate).toBe(245);
    expect(lines[1].rate).toBe(245);
  });

  it('the quote lines add up to the quote total', () => {
    const q = quoteFromSurvey(priced, 'Q-1');
    const sum = q.line_items!.reduce((n, li) => n + li.quantity * li.rate, 0);
    expect(sum).toBe(q.total);
  });

  it('will not let an unpriced schedule reach a quote', () => {
    const free = { ...priced, cameras: priced.cameras.map((c) => ({ ...c, unit_price: 0 })) };
    expect(readyToQuote(free)).toBe(false);
    expect(pageStatus(free)[3].missing.join(' ')).toMatch(/2 cameras with no price/);
  });
});

describe('placements page status', () => {
  it('does not claim Complete when there is nothing to photograph', () => {
    const st = pageStatus(survey({ client_name: 'X', site_name: 'Y', cameras: [] }));
    expect(st[2].done).toBe(false);
    expect(st[2].missing[0]).toBe('nothing to photograph yet');
  });

  it('still does not block the quote over photos', () => {
    const s = survey({
      client_name: 'X', site_name: 'Y', recommendations: 'Do it.',
      cameras: [cam({ id: 'a', position: 1, location: 'Lobby', cable_run: '25 ft', unit_price: 245, photos: [] })],
    });
    expect(pageStatus(s)[2].done).toBe(false);
    expect(readyToQuote(s)).toBe(true);
  });
});

// ── Cable estimating ────────────────────────────────────────────────────────

describe('reading feet out of a free-text run', () => {
  it('reads a plain number', () => {
    expect(parseRunFeet('25 ft')).toBe(25);
    expect(parseRunFeet('85ft')).toBe(85);
  });

  it('estimates a "<" ceiling and a range at the top, never the bottom', () => {
    // Under-estimating cable is how a job runs short on site.
    expect(parseRunFeet('<50 ft')).toBe(50);
    expect(parseRunFeet('50-100 ft')).toBe(100);
    expect(parseRunFeet('100–150 ft')).toBe(150);
    expect(parseRunFeet('200+ ft')).toBe(200);
  });

  it('gives a same-room run real slack rather than zero', () => {
    expect(parseRunFeet('Minimal, same room')).toBe(15);
  });

  it('refuses to invent a number it was not given', () => {
    expect(parseRunFeet('TBD')).toBeNull();
    expect(parseRunFeet('tbd')).toBeNull();
    expect(parseRunFeet('')).toBeNull();
    expect(parseRunFeet(null)).toBeNull();
    expect(parseRunFeet('unknown')).toBeNull();
  });
});

describe('cable estimate for the whole schedule', () => {
  it('totals the runs it can read and counts the ones it cannot', () => {
    const s = survey({
      cameras: [
        cam({ id: 'a', cable_run: '25 ft' }),
        cam({ id: 'b', cable_run: '<50 ft' }),
        cam({ id: 'c', cable_run: 'TBD' }),
        cam({ id: 'd', cable_run: 'Minimal, same room' }),
      ],
    });
    const e = cableEstimate(s);
    expect(e.feet).toBe(90);          // 25 + 50 + 15
    expect(e.known).toBe(3);
    expect(e.unknown).toBe(1);        // the TBD is counted, not hidden
  });

  it('adds the 15% service loop and rounds up to whole boxes', () => {
    const s = survey({ cameras: [cam({ id: 'a', cable_run: '900 ft' })] });
    const e = cableEstimate(s);
    expect(e.feetWithLoop).toBe(1035);  // 900 x 1.15
    expect(e.boxes).toBe(2);            // 1035 ft needs two 1000 ft boxes
  });

  it('reads drop run lengths on a cabling survey', () => {
    const s = survey({
      survey_type: 'cabling',
      cable_drops: [drop({ id: 'a', run_length: '85 ft' }), drop({ id: 'b', run_length: '120 ft' })],
      cameras: [cam({ id: 'ignored', cable_run: '999 ft' })],
    });
    expect(cableEstimate(s).feet).toBe(205);
  });

  it('is all zeros with nothing to estimate', () => {
    const e = cableEstimate(survey());
    expect(e).toEqual({ known: 0, unknown: 0, feet: 0, feetWithLoop: 0, boxes: 0 });
  });
});
