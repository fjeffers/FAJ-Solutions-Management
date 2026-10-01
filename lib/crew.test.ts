import { describe, it, expect } from 'vitest';
import {
  mondayOf, projectWeeks, hoursBetween, approvedHours, siteTravel, teamMoney, projectMoney,
  type CrewProject, type CrewTeam, type CrewSite, type CrewTimeEntry, type CrewReceipt, type CrewPayment,
} from './crew';

const project: CrewProject = {
  id: 'p', name: 'LDS', client: 'NetView', bill_rate: 90, travel_cap: 3000,
  start_date: '2026-10-19', weeks: 7, skip_weeks: ['2026-11-23'], notes: null, archived_at: null,
};
const teamA: CrewTeam = { id: 'A', project_id: 'p', lead_contractor_id: 'c1', name: 'Fred', helper_name: 'Davis', pay_rate: 80, sort: 0 };
const teamB: CrewTeam = { id: 'B', project_id: 'p', lead_contractor_id: 'c2', name: 'James', helper_name: null, pay_rate: 85, sort: 1 };
const sites: CrewSite[] = [
  { id: 's1', project_id: 'p', team_id: 'A', week_start: '2026-10-19', name: 'Wilmington', address: null, city: null, state: null, status: 'in_progress', notes: null },
  { id: 's2', project_id: 'p', team_id: 'B', week_start: '2026-10-19', name: 'Gaffney', address: null, city: null, state: null, status: 'in_progress', notes: null },
];
const entry = (id: string, team: string, site: string, hours: number, status: CrewTimeEntry['status']): CrewTimeEntry => ({
  id, team_id: team, site_id: site, work_date: '2026-10-19', start_time: null, end_time: null,
  hours, helper_present: true, note: null, status, entered_by: null,
});
const receipt = (id: string, team: string, site: string, amount: number, status: CrewReceipt['status']): CrewReceipt => ({
  id, team_id: team, site_id: site, receipt_date: '2026-10-19', category: 'hotel', vendor: null,
  amount, file_path: null, note: null, status, entered_by: null,
});

describe('dates', () => {
  it('finds the Monday of any day in the week', () => {
    expect(mondayOf('2026-10-19')).toBe('2026-10-19'); // Monday
    expect(mondayOf('2026-10-22')).toBe('2026-10-19'); // Thursday
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // Sunday belongs to the week before
  });
  it('lists project weeks and flags Thanksgiving week', () => {
    const w = projectWeeks(project);
    expect(w).toHaveLength(7);
    expect(w[0].monday).toBe('2026-10-19');
    expect(w[5].monday).toBe('2026-11-23');
    expect(w[5].skipped).toBe(true);
    expect(w.filter((x) => !x.skipped)).toHaveLength(6);
  });
  it('computes hours from start and end, refusing nonsense', () => {
    expect(hoursBetween('07:00', '15:30')).toBe(8.5);
    expect(hoursBetween('07:00', '07:00')).toBeNull();
    expect(hoursBetween('22:00', '02:00')).toBeNull();
    expect(hoursBetween(null, '15:00')).toBeNull();
  });
});

describe('money', () => {
  const entries = [
    entry('e1', 'A', 's1', 8, 'approved'),
    entry('e2', 'A', 's1', 8, 'submitted'),   // not approved yet: not billed, not owed
    entry('e3', 'B', 's2', 10, 'approved'),
    entry('e4', 'B', 's2', 9, 'rejected'),
  ];
  const receipts = [
    receipt('r1', 'A', 's1', 2500, 'approved'),
    receipt('r2', 'A', 's1', 800, 'approved'),  // pushes site 1 over the $3,000 cap
    receipt('r3', 'B', 's2', 150, 'submitted'),
    receipt('r4', 'B', 's2', 99, 'rejected'),
  ];
  const payments: CrewPayment[] = [
    { id: 'pay1', project_id: 'p', team_id: 'A', direction: 'to_lead', kind: 'labor', amount: 400, paid_on: '2026-10-24', method: null, reference: null, note: null },
    { id: 'pay2', project_id: 'p', team_id: null, direction: 'from_client', kind: 'labor', amount: 1000, paid_on: '2026-11-15', method: null, reference: null, note: null },
  ];

  it('counts only approved hours', () => {
    expect(approvedHours(entries)).toBe(18);
    expect(approvedHours(entries, 'A')).toBe(8);
  });

  it('caps reimbursable travel per site and reports the overage', () => {
    const t = siteTravel(receipts, 's1', 3000);
    expect(t.approved).toBe(3300);
    expect(t.billable).toBe(3000);
    expect(t.overCap).toBe(300);
    const t2 = siteTravel(receipts, 's2', 3000);
    expect(t2.submitted).toBe(150);   // rejected receipt excluded
    expect(t2.billable).toBe(0);      // nothing approved yet
  });

  it('works out what FAJ owes a lead and what it keeps', () => {
    const m = teamMoney(teamA, project, entries, receipts, payments);
    expect(m.hours).toBe(8);
    expect(m.laborBilled).toBe(720);   // 8 × $90
    expect(m.laborOwed).toBe(640);     // 8 × $80
    expect(m.margin).toBe(80);
    expect(m.travelOwed).toBe(3300);   // the lead fronted it all, cap or not
    expect(m.balance).toBe(640 + 3300 - 400);
  });

  it('rolls the project up for the client and the leads', () => {
    const m = projectMoney(project, [teamA, teamB], sites, entries, receipts, payments);
    expect(m.hours).toBe(18);
    expect(m.laborBilled).toBe(1620);
    expect(m.travelBillable).toBe(3000);
    expect(m.totalBillable).toBe(4620);
    expect(m.clientBalance).toBe(3620);
    expect(m.owedToLeads).toBe(640 + 3300 + 850);  // B: 10 × $85
    expect(m.paidToLeads).toBe(400);
    expect(m.margin).toBe(1620 - 640 - 850);
  });
});

describe('site upload', () => {
  it('reads a spreadsheet with headers in any order', async () => {
    const { parseSiteRows } = await import('./crew');
    const out = parseSiteRows([
      ['City', 'Site Name', 'State', 'Address'],
      ['Wilmington', 'Wilmington Ward', 'nc', '123 Market St'],
      ['', '', '', ''],
      ['Gaffney', 'Gaffney Branch', 'SC', null],
    ]);
    expect(out).toEqual([
      { name: 'Wilmington Ward', address: '123 Market St', city: 'Wilmington', state: 'NC' },
      { name: 'Gaffney Branch', address: null, city: 'Gaffney', state: 'SC' },
    ]);
  });
  it('reads pasted lines without headers and splits "City, ST"', async () => {
    const { parseSiteRows, splitPasted } = await import('./crew');
    const out = parseSiteRows(splitPasted('Beaufort Ward\t10 Bay St\tBeaufort, SC\nBeaufort Ward\t10 Bay St\tBeaufort, SC\nPinehurst | 5 Pine Rd | Pinehurst | NC'));
    expect(out).toEqual([
      { name: 'Beaufort Ward', address: '10 Bay St', city: 'Beaufort', state: 'SC' },
      { name: 'Pinehurst', address: '5 Pine Rd', city: 'Pinehurst', state: 'NC' },
    ]);
  });
});
