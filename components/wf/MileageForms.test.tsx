// @vitest-environment jsdom
//
// Picking Mileage on Add an expense (tech app) or Add receipt (office) asks for
// the miles, not an amount and a store, and the miles go to the day's miles
// (Fred, 2026-10-27: "when I click on mileage, it's asking for the amount ...
// for mileage ... it's supposed to basically go to mileage").
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { WfJob } from '@/lib/wf';
import { EXPENSE_CATEGORIES } from '@/lib/expenses';

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toastError, toastSuccess, toastInfo: vi.fn() }));
vi.mock('@/lib/use-expense-categories', () => ({ useExpenseCategories: () => ({ list: EXPENSE_CATEGORIES, add: vi.fn() }) }));
vi.mock('@/components/wf/Odometer', () => ({ readPhoto: vi.fn() }));
vi.mock('@/lib/photo-stamp', () => ({ shrinkPhoto: async (f: Blob) => f, stampPhoto: async (f: Blob) => f }));
// field_sheet_days for the office: the day isn't saved yet, so it's inserted.
const inserts: Record<string, unknown>[] = [];
const updates: Record<string, unknown>[] = [];
const dayQuery = () => {
  const q = {
    select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: async (row: Record<string, unknown>) => { inserts.push(row); return { error: null }; },
    // job_day_events: a drive's miles (Add miles on the work order).
    update: (patch: Record<string, unknown>) => ({ eq: async (_k: string, id: string) => { updates.push({ id, ...patch }); return { error: null }; } }),
  };
  return q;
};
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: dayQuery }) }));
const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, miles: 85, extraMiles: 85 }) }));
vi.stubGlobal('fetch', fetchMock);

const { default: ExpenseDialog } = await import('./ExpenseDialog');
const { OfficeReceiptDialog, MilesEdit } = await import('./ProjectOffice');
const { HOURS_CHANGED } = await import('@/lib/hours-look');

afterEach(() => { cleanup(); fetchMock.mockClear(); toastError.mockClear(); toastSuccess.mockClear(); inserts.length = 0; updates.length = 0; });

describe('Add an expense, in the tech app', () => {
  const job = { number: '19101412' } as unknown as WfJob;

  it('asks for the miles and the day when Mileage is picked, not an amount, store or receipt', () => {
    render(<ExpenseDialog job={job} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByLabelText('Amount')).toBeTruthy();
    expect(screen.getByLabelText('Store')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mileage' }));
    expect(screen.getByRole('dialog', { name: 'Add mileage' })).toBeTruthy();
    expect(screen.getByLabelText('Miles')).toBeTruthy();
    expect(screen.getByLabelText('Day driven')).toBeTruthy();
    for (const gone of ['Amount', 'Store', 'Note (optional)', 'Date on the receipt']) expect(screen.queryByLabelText(gone)).toBeNull();
    expect(screen.queryByText('Receipt photo')).toBeNull();
    // Any other choice is a receipt again.
    fireEvent.click(screen.getByRole('button', { name: 'Meals' }));
    expect(screen.getByLabelText('Amount')).toBeTruthy();
    expect(screen.getByLabelText('Store')).toBeTruthy();
  });

  it("sends the miles to the tech's day, not as a receipt", async () => {
    const onSaved = vi.fn();
    render(<ExpenseDialog job={job} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mileage' }));
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Day driven'), { target: { value: '2026-10-19' } });
    fireEvent.click(screen.getByRole('button', { name: /Add miles/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: FormData }];
    expect(url).toBe('/api/tech/mileage');
    expect(Object.fromEntries(init.body.entries())).toEqual({ wo_number: '19101412', miles: '85', date: '2026-10-19' });
    expect(toastSuccess).toHaveBeenCalledWith('85 mi added to your miles for Mon, Oct 19.');
  });
});

describe('Add receipt or miles, in the office', () => {
  it("asks for the tech, the miles and the day, and adds the miles to that tech's day on Hours", async () => {
    const onSaved = vi.fn();
    const changed = vi.fn();
    window.addEventListener(HOURS_CHANGED, changed);
    render(<OfficeReceiptDialog woId="wo-1" techs={['Paul Gibbs', 'Kendell Newbold']} onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('What for'), { target: { value: 'mileage' } });
    expect(screen.getByRole('dialog', { name: 'Add mileage' })).toBeTruthy();
    for (const gone of ['Amount', 'Store / hotel', 'Note (optional)', 'Receipt photo or PDF (optional)']) expect(screen.queryByLabelText(gone)).toBeNull();
    expect((screen.getByLabelText('Technician') as HTMLInputElement).value).toBe('Paul Gibbs');
    fireEvent.change(screen.getByLabelText('Technician'), { target: { value: 'Kendell Newbold' } });
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '85' } });
    fireEvent.change(screen.getByLabelText('Day driven'), { target: { value: '2026-10-19' } });
    fireEvent.click(screen.getByRole('button', { name: /Add miles/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(inserts).toEqual([expect.objectContaining({ wo_id: 'wo-1', tech: 'Kendell Newbold', day: '2026-10-19', edits: { extraMiles: 85 } })]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("85 mi added to Kendell Newbold's miles for Mon, Oct 19.");
    window.removeEventListener(HOURS_CHANGED, changed);
  });
});

describe("Add miles on a drive, on the work order (Fred, 2026-10-27: \"i add the milage 228010 then i add 40 it should be 228050\")", () => {
  it('takes the odometer at the end of a drive with no end photo, and adds the miles since its start', async () => {
    const onSaved = vi.fn();
    render(<MilesEdit id="end-1" miles={null} startReading={228010} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add miles' }));
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '228,050' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updates).toEqual([{ id: 'end-1', miles: 40, miles_from_gps: false }]);
    expect(toastSuccess).toHaveBeenCalledWith('228,050 − 228,010 = 40 mi added.');
  });

  it('takes plain miles too, and shows them as added', async () => {
    const onSaved = vi.fn();
    const { rerender } = render(<MilesEdit id="end-1" miles={null} startReading={228010} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add miles' }));
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '40' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updates).toEqual([{ id: 'end-1', miles: 40, miles_from_gps: false }]);
    rerender(<MilesEdit id="end-1" miles={40} typed startReading={228010} onSaved={onSaved} />);
    expect(screen.getByRole('button', { name: '+40 mi added' })).toBeTruthy();
  });

  it("says what to type when it's neither miles nor an odometer after the start", async () => {
    render(<MilesEdit id="end-1" miles={null} startReading={228010} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add miles' }));
    fireEvent.change(screen.getByLabelText('Miles'), { target: { value: '220010' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Type the miles, or the odometer at the end of this drive (it started at 228,010).'));
    expect(updates).toEqual([]);
  });
});
