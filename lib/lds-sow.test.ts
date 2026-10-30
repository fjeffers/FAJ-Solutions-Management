// The LDS church install template (Fred, 2026-10-29: "i want a template with this").
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { listFor, parseCloseoutLists } from './closeout';
import {
  isLdsJob, LDS_INSTALL_CHECKLIST, LDS_INSTALL_LIST, SOW_DAYS, sowFields, sowFileName,
} from './lds-sow';
import type { EnrichedWorkOrder } from './types';

// WO 19101414 as it is in the app.
const fayetteville = {
  wo_number: '19101414', title: 'LDS-1103    Site 5333202 — Fayetteville, NC', description: 'LDS-1103 Installation at site 5333202, Fayetteville, NC.',
  external_wo_id: 'LDS-1103', project_name: 'LDS NC Survey', client_reference: '5333202',
  site_address: '6420 Morganton Road', site_city: 'Fayetteville', site_state: 'NC', site_zip: '',
  start_date: '2026-10-26', end_date: '2026-10-30', start_time: '08:00',
  contractor_name: 'Dwayne Cudjoe', contractor_names: ['Kendell Newbold', 'Dwayne Cudjoe', 'Paul Gibbs'], lead_contractor_name: 'Dwayne Cudjoe',
  access_instructions: null, deliverable_link: 'https://drive.example/5333202', checkout_link: 'https://smartsheet.example/checkout',
} as unknown as EnrichedWorkOrder;
const techs = [{ name: 'Dwayne Cudjoe', phone: ' 910-555-0101 ' }, { name: 'Kendell Newbold', phone: null }];

describe('isLdsJob', () => {
  it('knows an LDS job by its title, ticket or project', () => {
    expect(isLdsJob(fayetteville)).toBe(true);
    expect(isLdsJob({ title: 'Network refresh', description: '', external_wo_id: null, project_name: 'LDS NC Cabling' })).toBe(true);
    expect(isLdsJob({ title: 'Meetinghouse network refresh', description: null, external_wo_id: null, project_name: null })).toBe(true);
  });
  it('leaves other jobs alone, "fields" and "builds" included', () => {
    expect(isLdsJob({ title: "Wendy's #1234 POS cabling", description: 'Run 4 drops', external_wo_id: 'W-1234', project_name: null })).toBe(false);
    expect(isLdsJob({ title: 'Fields install', description: 'Builds out the IDF; holds the old rack', external_wo_id: null, project_name: null })).toBe(false);
  });
});

describe('sowFields', () => {
  it('fills the SOW from the work order, the lead tech first', () => {
    const f = sowFields(fayetteville, techs, { name: 'Fred', phone: '555-0100' });
    expect(f).toMatchObject({
      siteId: '5333202', ticket: 'LDS-1103', faWo: '19101414',
      address: '6420 Morganton Road', city: 'Fayetteville', state: 'NC', zip: '',
      startDate: '10/26/26', endDate: '10/30/26', startTime: '8:00 AM',
      leadTech: 'Dwayne Cudjoe', leadPhone: '910-555-0101', secondTech: 'Kendell Newbold', secondPhone: '',
      lockbox: '', deliverables: 'https://drive.example/5333202', checkout: 'https://smartsheet.example/checkout',
      fajContact: 'Fred', fajPhone: '555-0100', hotel: '113.00', meals: '50.00', mileage: '0.60',
    });
  });
  it('reads the start time in 12-hour words, 8:00 AM when there is none', () => {
    const at = (t: string | null) => sowFields({ ...fayetteville, start_time: t }, [], { name: '', phone: '' }).startTime;
    expect(at('13:30')).toBe('1:30 PM');
    expect(at('00:15')).toBe('12:15 AM');
    expect(at('12:00')).toBe('12:00 PM');
    expect(at(null)).toBe('8:00 AM');
  });
  it('leaves a box empty that the job does not have', () => {
    const f = sowFields({ ...fayetteville, contractor_name: null, contractor_names: null, lead_contractor_name: null, start_date: null } as unknown as EnrichedWorkOrder, [], { name: '', phone: '' });
    expect([f.leadTech, f.secondTech, f.startDate]).toEqual(['', '', '']);
  });
});

describe('sowFileName', () => {
  it('names the PDF for the ticket, site and town', () => {
    expect(sowFileName(sowFields(fayetteville, [], { name: '', phone: '' }))).toBe('Installer SOW LDS-1103 Site 5333202 — Fayetteville, NC');
    expect(sowFileName({ ticket: '', siteId: '', city: '', state: '' })).toBe('Installer SOW');
  });
});

describe('the five days', () => {
  it('has every day, each row with its columns', () => {
    expect(SOW_DAYS.map((d) => d.n)).toEqual([1, 2, 3, 4, 5]);
    for (const d of SOW_DAYS) {
      expect(d.activities.every((r) => r.length === 4)).toBe(true);
      expect(d.deliverables.every((r) => r.length === 3)).toBe(true);
      expect(d.signoff.length).toBeGreaterThan(0);
    }
  });
});

describe('the techs’ checklist', () => {
  it('fits the closeout (60 items, 200 characters each), day by day, no repeats', () => {
    expect(LDS_INSTALL_CHECKLIST.length).toBeLessThanOrEqual(60);
    expect(LDS_INSTALL_CHECKLIST.every((i) => i.length <= 200)).toBe(true);
    expect(new Set(LDS_INSTALL_CHECKLIST).size).toBe(LDS_INSTALL_CHECKLIST.length);
    const days = LDS_INSTALL_CHECKLIST.map((i) => Number(/^Day (\d) · /.exec(i)?.[1]));
    expect(days.every((d, k) => d >= 1 && d <= 5 && (k === 0 || d >= days[k - 1]))).toBe(true);
  });

  it('is what the migration puts in the app, item for item', () => {
    const sql = readFileSync('supabase-migration-145-lds-install-list.sql', 'utf8');
    const items = [...sql.matchAll(/^ {4}'((?:[^']|'')*)',?$/gm)].map((m) => m[1].replace(/''/g, "'"));
    expect(items).toEqual(LDS_INSTALL_CHECKLIST);
    expect(sql).toContain(`ARRAY[${LDS_INSTALL_LIST.keywords.map((k) => `'${k}'`).join(', ')}]`);
    expect(sql).toContain(`'${LDS_INSTALL_LIST.name}'`);
  });

  it('is picked for an LDS install; a survey keeps the survey list; other jobs keep theirs', () => {
    const lists = parseCloseoutLists([
      { id: 'k', name: 'Kiosk install', keywords: ['kiosk'], items: ['Completed kiosk'], sort: 1 },
      { id: 's', name: 'Site survey', keywords: ['survey'], items: ['Completed site survey form'], sort: 2 },
      { id: 'l', ...LDS_INSTALL_LIST, items: LDS_INSTALL_CHECKLIST },
      { id: 'd', name: 'Standard job', keywords: [], items: ['Work area cleaned up'], sort: 99 },
    ]);
    expect(listFor(lists, fayetteville.title!, fayetteville.description ?? '').name).toBe(LDS_INSTALL_LIST.name);
    expect(listFor(lists, 'LDS-1105 Cabling Site 5330467 — Rockingham, NC', 'LDS-1105 Installation at site 5330467').name).toBe(LDS_INSTALL_LIST.name);
    expect(listFor(lists, 'LDS-1075 Survey Site 5003326 — Scarsdale, NY', 'NetView LDS survey, Site ID 5003326.').name).toBe('Site survey');
    expect(listFor(lists, 'Fields office cabling', 'Builds out the IDF').name).toBe('Standard job');
  });
});
