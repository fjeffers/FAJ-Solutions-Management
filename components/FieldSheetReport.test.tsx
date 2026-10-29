// @vitest-environment jsdom
//
// The client report's By technician section (Fred, 2026-10-29: "I need a break down from each tech").
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { parseSettings, sheetTotals, type TechBreakdown } from '@/lib/field-sheet';
import FieldSheetReport from './FieldSheetReport';

const s = { ...parseSettings({}), receiptsAtCost: true };
const lowes = (billed: boolean): TechBreakdown => ({
  tech: 'Paul Gibbs', days: 0, hours: 0, travel: 0, total: 0, labor: null, miles: 0, mileage: 0,
  materials: [{ id: 'l', date: '2026-10-20', category: 'materials', vendor: "Lowe's", amount: 47.48 }], materialsTotal: 47.48, materialsBilled: billed,
});
const show = (perTech: TechBreakdown[]) => render(
  <FieldSheetReport site="Gaffney" client="LDS" wo="19101401" clientWo={null} address="" from="2026-10-20" to="2026-10-20"
    rows={[]} s={s} totals={sheetTotals([], [], s)} perTech={perTech} receipts={[]} photos={[]} onClose={() => {}} />,
);

afterEach(cleanup);

describe('the client report, by technician', () => {
  // Greptile on PR #33: a week with materials bought and no hours kept the materials off.
  it('shows the materials bought in a week with no hours', () => {
    show([lowes(true)]);
    const report = document.getElementById('job-log-root')!;
    expect(within(report).getByText('By technician')).toBeTruthy();
    expect(within(report).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['3. Materials']);
    expect(within(report).getAllByText('$47.48').length).toBeGreaterThan(0);
  });

  it('leaves out materials the client is not billed for', () => {
    show([lowes(false)]);
    expect(screen.queryByText('By technician')).toBeNull();
  });
});
