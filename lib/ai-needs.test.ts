import { describe, it, expect } from 'vitest';
import { applyNeeds, defaultNeeds, foundParts, isTechContact, type Found } from './ai-needs';

// What the AI read from the NetView email for Gaffney (Fred's test, 2026-10-18).
const DRIVE = 'https://drive.google.com/drive/folders/abc';
const FORM = 'https://app.smartsheet.com/b/form/xyz';
const gaffney: Found = {
  title: 'LDS Site 5011876 — Gaffney, SC',
  site_address: '701 West Buford Street',
  description: 'NetView LDS ticket LDS-1110 for Site ID 5011876.',
  capture: ['travel', 'odometer', 'receipts', 'photos'],
  capture_why: 'Out-of-town job with a hotel stay.',
  contacts: [
    { id: 'c1', name: 'Mike Wise', label: 'NetView Coordinator', phone: '724-281-3357', email: 'mike.wise@example.com' },
    { id: 'c2', name: 'Paul Gibbs', label: 'Lead Tech', phone: '954-224-1283', email: 'paul@example.com' },
    { id: 'c3', name: 'Raja Bennett', label: 'Helper', phone: '904-553-5538', email: 'raja@example.com' },
  ],
  poc_name: null, poc_phone: '(954) 224-1283', poc_email: 'paul@example.com',
  client_links: [DRIVE, FORM],
  checkout_link: FORM,
  checkin_link: 'https://teams.microsoft.com/l/not-in-the-links',
  wo_tasks: [{ id: 't1', category: 'On Site', label: 'Do the work', completed: false, completed_at: null }],
  access_instructions: 'Lockbox in the mechanical closet.',
  parts_materials: 'Material arrives Monday 10 am.',
  deliverables: 'Upload to the Drive folder',
  total_amount: 1200,
};

describe('Generate with AI asks before it builds (Fred, 2026-10-18)', () => {
  it('starts with what the AI read the job needs, every contact but the techs, and every link', () => {
    const n = defaultNeeds(gaffney, null);
    expect(n.capture).toEqual(['travel', 'odometer', 'receipts', 'photos']);
    expect(n.contacts).toEqual(['c1']);
    expect(n.links).toEqual([DRIVE, FORM]);
    expect(n.checkout).toBe(FORM);
    expect(n.checkin).toBe(''); // a link that isn't on the list is never picked
    expect(n.mileage).toBe(true);
  });

  it("starts with the template's items when the template has some", () => {
    expect(defaultNeeds(gaffney, ['travel', 'lunch']).capture).toEqual(['travel', 'lunch']);
  });

  it('knows a tech from a site contact', () => {
    expect(gaffney.contacts!.map(isTechContact)).toEqual([false, true, true]);
  });

  it('builds only what Fred kept', () => {
    const out = applyNeeds(gaffney, defaultNeeds(gaffney, null));
    expect(out.capture).toEqual(['travel', 'odometer', 'receipts', 'photos']);
    expect(out.wo_tasks).toBeUndefined(); // no Checklist ticked
    expect(out.contacts?.map((c) => c.name)).toEqual(['Mike Wise']);
    // Paul was left off, so he isn't the site contact either.
    expect(out.poc_email).toBeUndefined();
    expect(out.poc_phone).toBeUndefined();
    expect(out.checkout_link).toBe(FORM);
    expect(out.checkin_link).toBeUndefined();
    expect('capture_why' in out).toBe(false);
    expect(out.billable_miles).toBeUndefined();
  });

  it('leaves off whatever Fred unticks', () => {
    const n = { ...defaultNeeds(gaffney, null), capture: ['checklist' as const], links: [DRIVE], access: false, parts: false, deliverables: false, money: false, mileage: false };
    const out = applyNeeds(gaffney, n);
    expect(out.wo_tasks).toHaveLength(1);
    expect(out.client_links).toEqual([DRIVE]);
    expect(out.checkout_link).toBeUndefined(); // its link was left off
    expect(out.access_instructions).toBeUndefined();
    expect(out.parts_materials).toBeUndefined();
    expect(out.deliverables).toBeUndefined();
    expect(out.total_amount).toBeUndefined();
    expect(out.billable_miles).toBe(0); // no mileage charge worked out when the job opens
    expect(out.description).toBe(gaffney.description); // the job itself always goes on
  });

  it('says which optional parts the email had', () => {
    expect(foundParts(gaffney)).toEqual({ access: true, parts: true, deliverables: true, money: true });
    expect(foundParts({ title: 'x' })).toEqual({ access: false, parts: false, deliverables: false, money: false });
  });
});
