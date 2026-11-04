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

// Fred, 2026-11-02: "i can only upload ond file not two".
describe('Generate with AI: more than one file', () => {
  it('keeps every file picked and sends them all to the AI', async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ result: { site_address: '1 Main St' }, source: 'ai', filled: 1 })));
    vi.stubGlobal('fetch', fetchSpy);
    render(<AIGenerateModal onClose={() => {}} onGenerated={() => {}} />);
    const input = screen.getByLabelText('Work order files') as HTMLInputElement;
    await userEvent.upload(input, [
      new File(['%PDF-1.4'], 'work-order.pdf', { type: 'application/pdf' }),
      new File(['png'], 'sow-photo.png', { type: 'image/png' }),
    ]);
    expect(await screen.findByText(/work-order\.pdf/)).toBeTruthy();
    expect(screen.getByText(/sow-photo\.png/)).toBeTruthy();
    await userEvent.upload(input, new File(['%PDF-1.4'], 'site-plan.pdf', { type: 'application/pdf' }));
    expect(await screen.findByText(/site-plan\.pdf/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remove sow-photo.png' }));
    expect(screen.queryByText(/sow-photo\.png/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /Read the job/ }));
    const body = JSON.parse(String((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.files.map((f: { type: string }) => f.type)).toEqual(['application/pdf', 'application/pdf']);
  });
});
