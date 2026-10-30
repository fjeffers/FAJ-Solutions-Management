// @vitest-environment jsdom
//
// The Installer SOW for an LDS church site (Fred, 2026-10-29: "i want a template with this").
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import SowDocument from './SowDocument';
import type { Contractor, EnrichedWorkOrder } from '@/lib/types';

const w = {
  id: 'wo-1', wo_number: '19101414', title: 'LDS-1103    Site 5333202 — Fayetteville, NC', description: '',
  external_wo_id: 'LDS-1103', project_name: 'LDS NC Survey', client_reference: '5333202',
  site_address: '6420 Morganton Road', site_city: 'Fayetteville', site_state: 'NC', site_zip: '',
  start_date: '2026-10-26', end_date: '2026-10-30', start_time: '08:00',
  contractor_name: 'Dwayne Cudjoe', contractor_names: ['Dwayne Cudjoe', 'Kendell Newbold'], lead_contractor_name: 'Dwayne Cudjoe',
  access_instructions: 'Lockbox 1234 on the east door', deliverable_link: null, checkout_link: null,
} as unknown as EnrichedWorkOrder;
const contractors = [{ id: 'c1', name: 'Dwayne Cudjoe', phone: '910-555-0101' }] as unknown as Contractor[];
const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

beforeEach(() => { localStorage.clear(); document.title = 'FAJ'; });
afterEach(cleanup);

describe('the Installer SOW', () => {
  it('comes filled in from the work order', () => {
    render(<SowDocument w={w} contractors={contractors} author="Fred" onClose={() => {}} />);
    expect(box('Site ID').value).toBe('5333202');
    expect(box('Ticket').value).toBe('LDS-1103');
    expect(box('Start date').value).toBe('10/26/26');
    expect(box('Lead tech').value).toBe('Dwayne Cudjoe');
    expect(box('Lead tech phone').value).toBe('910-555-0101');
    expect(box('Second tech').value).toBe('Kendell Newbold');
    expect(box('Lockbox / access').value).toBe('Lockbox 1234 on the east door');
    expect(box('FAJ contact').value).toBe('Fred');
  });

  it('has each of the five days with its sign-off, under FAJ’s name', () => {
    render(<SowDocument w={w} contractors={contractors} onClose={() => {}} />);
    const page = document.getElementById('job-log-root')!;
    for (const n of [1, 2, 3, 4, 5]) expect(within(page).getByRole('heading', { level: 2, name: new RegExp(`^Day ${n} — `) })).toBeTruthy();
    expect(within(page).getAllByText(/^Day \d sign-off$/)).toHaveLength(5);
    expect(within(page).getByAltText(/FAJ Solutions/)).toBeTruthy();
    expect(within(page).getByText('INSTALLER SOW')).toBeTruthy();
  });

  it('names the PDF for the site while it is open, and prints alone', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { unmount } = render(<SowDocument w={w} contractors={contractors} onClose={() => {}} />);
    expect(document.title).toBe('Installer SOW LDS-1103 Site 5333202 — Fayetteville, NC');
    expect(document.body.classList.contains('job-log-open')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /print/i }));
    expect(print).toHaveBeenCalled();
    unmount();
    expect(document.title).toBe('FAJ');
    expect(document.body.classList.contains('job-log-open')).toBe(false);
    print.mockRestore();
  });

  it('keeps a typed change on the page, and remembers the FAJ phone for the next SOW', () => {
    const { unmount } = render(<SowDocument w={w} contractors={contractors} author="Fred" onClose={() => {}} />);
    fireEvent.change(box('Site ID'), { target: { value: '5333203' } });
    expect(box('Site ID').value).toBe('5333203');
    expect(document.title).toBe('Installer SOW LDS-1103 Site 5333203 — Fayetteville, NC');
    fireEvent.change(box('FAJ phone'), { target: { value: '267-555-0199' } });
    unmount();
    render(<SowDocument w={w} contractors={contractors} author="Fred" onClose={() => {}} />);
    expect(box('FAJ phone').value).toBe('267-555-0199');
    expect(box('Site ID').value).toBe('5333202');
  });
});
