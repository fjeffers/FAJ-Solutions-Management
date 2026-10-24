// @vitest-environment jsdom
//
// Generate with AI with a row pasted from the LDS tracker. It went straight into
// the form; Fred, 2026-10-24: "it read it and asks me, hey, do I need this, do I
// need that ... took away that first part with the links". It asks again.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/components/useJobTemplates', () => ({ useJobTemplates: () => ({ templates: [] }) }));

const { AIGenerateModal } = await import('./WorkOrdersView');

const ROW = ['LDS-1103', '5333202', '10/26/2026', '8:00 AM', '10/30/2026', 'Pending Tech Assignment', '', '', 'Legacy',
  '6420 Morganton Road', 'FAYETTEVILLE', 'NC', '#N/A', 'https://drive.google.com/drive/folders/1aqfqWvObtuf-ztduAtdQDuH6EYKqAXvl', '.', '',
  'https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82',
  'Dwayne Cudjoe', '678-760-2268', 'cudjoedwayne@yahoo.com', 'Kendell Newbold', '470-263-5337', 'kendallnewbold@gmail.com',
  'Cabling', 'LDS-1103 - 5333202 - FAYETTEVILLE'].join('\t');

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Generate with AI: a tracker row', () => {
  it('asks what the job needs before it builds, and keeps only the links Fred keeps', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const onGenerated = vi.fn();
    render(<AIGenerateModal onClose={() => {}} onGenerated={onGenerated} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ROW } });
    await userEvent.click(screen.getByRole('button', { name: /Read the job/ }));

    expect(onGenerated).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Read from the tracker row/)).toBeTruthy();
    expect(screen.queryByText(/The AI didn.t read this one/)).toBeNull();

    // Leave the Drive folder off; the Smartsheet form stays.
    const drive = screen.getAllByRole('checkbox').find((c) => c.closest('label')?.textContent?.match(/drive|Drive/));
    expect(drive).toBeTruthy();
    await userEvent.click(drive!);
    await userEvent.click(screen.getByRole('button', { name: /Build the job/ }));

    expect(onGenerated).toHaveBeenCalledTimes(1);
    expect(onGenerated.mock.calls[0][0]).toMatchObject({
      external_wo_id: 'LDS-1103', client_reference: '5333202', site_address: '6420 Morganton Road',
      contractor_names: ['Dwayne Cudjoe', 'Kendell Newbold'],
      client_links: ['https://app.smartsheet.com/b/form/01a13c4a09bf7ac8bb9c6fdd595e1a82'],
    });
  });
});
