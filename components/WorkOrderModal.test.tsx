// @vitest-environment jsdom
//
// Fred, 2026-10-05: "cant edit work orders". Save stayed greyed out on every
// job without a tech (about 30 open ones), with nothing saying why. A job only
// needs its number to save; no tech yet is normal ("Needs a tech" on Dispatch).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WorkOrder } from '@/lib/types';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null }), eq: () => ({ order: async () => ({ data: [] }) }) }) }),
  }),
}));
vi.mock('@/lib/toast', () => ({ toastError: () => {}, toastSuccess: () => {}, toastInfo: () => {} }));
vi.mock('@/components/WOTimeLogs', () => ({ default: () => null }));
vi.mock('@/components/HoursView', () => ({ JobDays: () => null }));
vi.mock('@/components/WorkOrderChatPanel', () => ({ default: () => null }));

import WorkOrderModal from './WorkOrderModal';
import { setFieldsNow, EMPTY_FIELDS } from '@/lib/custom-fields';

const NO_TECH = {
  id: 'wo1', wo_number: '19101322', title: 'CHERRY HILL', contractor_name: '', contractor_names: null,
  wo_status: 'Open', total_amount: 250, source_platform: 'Internal', archived_at: null,
} as unknown as WorkOrder;

afterEach(() => { cleanup(); setFieldsNow(EMPTY_FIELDS); });

describe('Edit job', () => {
  it('saves a job that has no tech yet', async () => {
    const onSave = vi.fn();
    render(<WorkOrderModal item={NO_TECH} contractors={[]} questionTemplates={[]} onSave={onSave} onClose={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save Changes' });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'wo1', wo_number: '19101322', contractor_name: '', contractor_names: null });
  });

  it('says why Save is off when the number is missing', () => {
    render(<WorkOrderModal item={{ ...NO_TECH, wo_number: '' }} contractors={[]} questionTemplates={[]} onSave={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('button', { name: 'Save Changes' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Add a work order number to save.')).toBeTruthy();
  });

  it("saves Fred's own fields with the job (Settings -> Custom fields)", async () => {
    setFieldsNow({ ...EMPTY_FIELDS, jobs: [{ id: 'gate', label: 'Gate code', kind: 'text', options: [], hidden: false }] });
    const onSave = vi.fn();
    render(<WorkOrderModal item={{ ...NO_TECH, custom: { old: 'kept' } }} contractors={[]} questionTemplates={[]} onSave={onSave} onClose={() => {}} />);
    await userEvent.type(screen.getByLabelText('Gate code'), '4321#');
    await userEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(onSave.mock.calls[0][0].custom).toEqual({ old: 'kept', gate: '4321#' });
  });
});
