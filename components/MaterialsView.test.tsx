// @vitest-environment jsdom
//
// The Materials screen grew three things at once: kits, a receipt-to-inventory
// door, and a barcode lookup. All three are wiring — the maths is unit-tested
// next door in lib/, but wiring is exactly what silently fails to reach the
// screen. These render the real component and click it the way Fred would.
//
// The dead Save button is in here on purpose: clicking Save with no name used
// to do nothing at all, which is what "I tried adding an item but it didn't
// save" turned out to be.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MaterialsView from './MaterialsView';
import type { Material, MaterialKit } from '@/lib/types';

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({
  toastError: (...a: unknown[]) => toastError(...a),
  toastSuccess: (...a: unknown[]) => toastSuccess(...a),
  toastInfo: () => {},
}));

const mat = (over: Partial<Material>): Material => ({
  id: 'm1', user_id: 'u1', name: 'Cat6 Box', description: null, category: 'cable', unit: 'box',
  stock_quantity: 4, low_stock_threshold: 2, unit_cost: 120, supplier: null, sku: '0123456789012',
  location: 'Van shelf 2', notes: null, created_at: '', updated_at: '', ...over,
});

const kit = (over: Partial<MaterialKit>): MaterialKit => ({
  id: 'k1', user_id: 'u1', name: 'Camera drop', description: 'One indoor dome',
  items: [
    { id: 'i1', material_id: 'm1', name: 'Cat6 Box', quantity: 1, unit_cost: 120 },
    { id: 'i2', material_id: null, name: 'Wall anchors', quantity: 4, unit_cost: 0.5 },
  ],
  created_at: '', updated_at: '', ...over,
});

function renderView(over: Partial<Parameters<typeof MaterialsView>[0]> = {}) {
  const props = {
    materials: [mat({})],
    kits: [kit({})],
    onSave: vi.fn(async () => {}),
    onDelete: vi.fn(),
    onSaveKit: vi.fn(async () => {}),
    onDeleteKit: vi.fn(),
    onStockIn: vi.fn(async () => {}),
    ...over,
  };
  render(<MaterialsView {...props} />);
  return props;
}

afterEach(() => { cleanup(); toastError.mockClear(); toastSuccess.mockClear(); });

describe('Materials screen', () => {
  it('shows the inventory with its stock and the scan tools', () => {
    renderView();
    expect(screen.getByText('Cat6 Box')).toBeTruthy();
    expect(screen.getByText('Add from receipt')).toBeTruthy();
    expect(screen.getByText('Scan an item')).toBeTruthy();
  });

  it('switches to Kits and shows what is in one, priced', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Kits'));
    expect(screen.getByText('Camera drop')).toBeTruthy();
    expect(screen.getByText('Wall anchors')).toBeTruthy();
    // 1 x 120 + 4 x 0.50
    expect(screen.getByText('$122.00')).toBeTruthy();
  });
});

describe('saving without a name', () => {
  it('says what is missing instead of a Save button that does nothing', async () => {
    const user = userEvent.setup();
    const props = renderView({ materials: [] });
    await user.click(screen.getByText('Add Material'));
    await user.click(screen.getByText('Save'));
    expect(props.onSave).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Give the item a name first');
  });

  it('saves once a name is typed, trimmed', async () => {
    const user = userEvent.setup();
    const props = renderView({ materials: [] });
    await user.click(screen.getByText('Add Material'));
    await user.type(screen.getByPlaceholderText('What the item is called'), '  Keystone jack  ');
    await user.click(screen.getByText('Save'));
    expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Keystone jack' }));
  });

  it('does the same for a kit with no name', async () => {
    const user = userEvent.setup();
    const props = renderView({ kits: [] });
    await user.click(screen.getByText('Kits'));
    await user.click(screen.getByText('New Kit'));
    await user.click(screen.getByText('Save Kit'));
    expect(props.onSaveKit).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('Give the kit a name first — it is the top field');
  });
});

describe('getting a receipt in', () => {
  it('accepts a screenshot or a saved PDF, not just the camera', async () => {
    // `capture` sends the phone straight to the camera and hides the gallery
    // and Files. With it set, a receipt that is already a screenshot or a PDF
    // is unreachable — which is exactly what happened on Fred's phone.
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Add from receipt'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.getAttribute('accept')).toContain('application/pdf');
    expect(input.getAttribute('accept')).toContain('image/*');
    expect(input.hasAttribute('capture')).toBe(false);
  });

  it('offers one way in, not a row of them', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Add from receipt'));
    expect(document.querySelectorAll('input[type="file"]').length).toBe(1);
    expect(screen.getByText('Scan or upload a receipt')).toBeTruthy();
  });
});

describe('barcode lookup', () => {
  it('finds a stocked item by its barcode and shows how many are on the shelf', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Scan an item'));
    await user.type(screen.getByPlaceholderText('or type a barcode / part number'), '0123456789012');
    await user.click(screen.getByText('Look up'));
    // "Van shelf 2" only appears on the scan result card; the stock figure
    // shows twice (table + card), which is fine — assert it is on the card.
    const card = screen.getByText('Van shelf 2').closest('div')!;
    expect(card.textContent).toContain('4 box');
  });

  it('offers to add an unknown code as a new item, with the code as its SKU', async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByText('Scan an item'));
    await user.type(screen.getByPlaceholderText('or type a barcode / part number'), '9999999999');
    await user.click(screen.getByText('Look up'));
    expect(screen.getByText('Not in your inventory yet.')).toBeTruthy();
    await user.click(screen.getByText('Add it as a new item'));
    // The Add Material modal opens with the scanned code already in the SKU
    // box — so the value now appears twice: the scan box and the SKU field.
    // "Add Material" is both the toolbar button and the modal title once open.
    expect(screen.getAllByText('Add Material').length).toBe(2);
    expect(screen.getAllByDisplayValue('9999999999').length).toBeGreaterThanOrEqual(2);
  });
});
