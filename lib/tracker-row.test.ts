import { describe, it, expect } from 'vitest';
import { isTrackerRow, parseTrackerRow } from './tracker-row';

// The row Fred pasted on 2026-10-24, tabs and blank cells as they come out of the tracker.
const ROW = [
  'LDS-1103', '5333202', '10/26/2026', '8:00 AM', '10/30/2026', 'Pending Tech Assignment', '', '', 'Legacy',
  '6420 Morganton Road', 'FAYETTEVILLE', 'NC', '#N/A', 'https://drive.google.com/drive/folders/1aqfqWvObtuf-ztduAtdQDuH6EYKqAXvl', '.', '',
  'https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82',
  'Dwayne Cudjoe', '678-760-2268', 'cudjoedwayne@yahoo.com', 'Kendell Newbold', '470-263-5337', 'kendallnewbold@gmail.com',
  'Cabling', 'LDS-1103 - 5333202 - FAYETTEVILLE',
].join('\t');

describe('parseTrackerRow', () => {
  it('reads the LDS tracker row into a new job set up like the other LDS jobs', () => {
    expect(isTrackerRow(ROW)).toBe(true);
    expect(parseTrackerRow(ROW)).toMatchObject({
      title: 'LDS Cabling Site 5333202 — Fayetteville, NC',
      external_wo_id: 'LDS-1103', client_reference: '5333202', customer_name: 'LDS', project_name: 'LDS NC Cabling', is_project: true,
      buyer_company: 'NetView', source_platform: 'NetView', assignment_type: 'Subcontract', service_type: 'Low Voltage', wo_status: 'Open',
      start_date: '2026-10-26', start_time: '08:00', end_date: '2026-10-30',
      site_name: 'LDS Site 5333202', site_address: '6420 Morganton Road', site_city: 'Fayetteville', site_state: 'NC', site_zip: null,
      contractor_name: 'Dwayne Cudjoe', contractor_names: ['Dwayne Cudjoe', 'Kendell Newbold'],
      client_links: ['https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82', 'https://drive.google.com/drive/folders/1aqfqWvObtuf-ztduAtdQDuH6EYKqAXvl'],
      checkout_link: 'https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82',
    });
    expect(parseTrackerRow(ROW)).toMatchObject({ client_status: 'Pending Tech Assignment', client_program: 'Legacy' });
    expect(parseTrackerRow(ROW)!.description).toBe('LDS cabling at site 5333202, Fayetteville, NC. Tracker: LDS-1103 - 5333202 - FAYETTEVILLE.');
  });

  it('reads a 1 PM start and a zip, and leaves anything that is not a tracker row to the AI', () => {
    const row = ROW.replace('8:00 AM', '1:30 PM').replace('#N/A', '28314');
    expect(parseTrackerRow(row)).toMatchObject({ start_time: '13:30', site_zip: '28314' });
    expect(parseTrackerRow("Field Nation WO 1234567 — Wendy's #5798, 123 Main St")).toBeNull();
    expect(isTrackerRow('LDS-1103 is the ticket')).toBe(false);
  });
});
