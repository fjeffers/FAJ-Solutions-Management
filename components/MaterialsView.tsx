'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Edit2, Trash2, X, AlertTriangle, Package, Layers, Receipt, ScanLine, Camera, Paperclip } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import { kitCost, newKitItem } from '@/lib/material-kits';
import { matchToInventory, planStockIn, stockInCost, findByCode, type StockInRow, type StockInPlan } from '@/lib/stock-in';
import { supportsLiveScan, readBarcodeFromFile, startLiveScan, type LiveScan } from '@/lib/barcode';
import type { Material, MaterialKit, MaterialKitItem } from '@/lib/types';
import { backdropClose } from '@/lib/backdrop';

type Severity = 'out' | 'critical' | 'low' | 'ok';

function severityOf(m: Material): Severity {
  if (m.stock_quantity <= 0) return 'out';
  if (m.low_stock_threshold != null) {
    if (m.stock_quantity <= m.low_stock_threshold * 0.5) return 'critical';
    if (m.stock_quantity <= m.low_stock_threshold) return 'low';
  }
  return 'ok';
}

const SEVERITY_META: Record<Severity, { label: string; color: string; bg: string }> = {
  out:      { label: 'Out of Stock', color: '#b91c1c', bg: 'rgba(239,68,68,0.12)' },
  critical: { label: 'Critical',     color: '#b91c1c', bg: 'rgba(239,68,68,0.08)' },
  low:      { label: 'Low Stock',    color: '#b45309', bg: 'rgba(245,158,11,0.12)' },
  ok:       { label: 'In Stock',     color: '#047857', bg: 'rgba(16,185,129,0.1)' },
};

export default function MaterialsView({
  materials,
  kits,
  onSave,
  onDelete,
  onSaveKit,
  onDeleteKit,
  onStockIn,
}: {
  materials: Material[];
  kits: MaterialKit[];
  onSave: (m: Partial<Material>) => Promise<void>;
  onDelete: (id: string) => void;
  onSaveKit: (k: Partial<MaterialKit>) => Promise<void>;
  onDeleteKit: (id: string) => void;
  onStockIn: (plan: StockInPlan) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Partial<Material> | null>(null);
  const [editingKit, setEditingKit] = useState<Partial<MaterialKit> | null>(null);
  const [section, setSection] = useState<'inventory' | 'kits'>('inventory');
  const [filter, setFilter] = useState<'all' | 'low'>('all');

  const rows = useMemo(() => {
    const withSeverity = materials.map((m) => ({ m, severity: severityOf(m) }));
    const filtered = filter === 'low' ? withSeverity.filter((r) => r.severity !== 'ok') : withSeverity;
    return filtered.sort((a, b) => a.m.name.localeCompare(b.m.name));
  }, [materials, filter]);

  const lowCount = materials.filter((m) => severityOf(m) !== 'ok').length;

  return (
    <div className="view-inner" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>INVENTORY</div>
          <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Materials</h1>
          <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
            {materials.length} item{materials.length !== 1 ? 's' : ''}
            {lowCount > 0 && <span style={{ color: '#b45309', fontWeight: 600 }}> · {lowCount} need attention</span>}
            {kits.length > 0 && <span> · {kits.length} kit{kits.length !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {section === 'inventory' ? (
            <>
              <button className={`filter-chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>All</button>
              <button className={`filter-chip ${filter === 'low' ? 'active' : ''}`} onClick={() => setFilter('low')}>Needs Attention</button>
              <button className="btn btn-primary" onClick={() => setEditing({})}>
                <Plus size={14} /> Add Material
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditingKit({ items: [] })}>
              <Plus size={14} /> New Kit
            </button>
          )}
        </div>
      </div>

      {/* Two things live here: what's on the shelf, and the saved recipes that
          pull from it. */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        <button className={`filter-chip ${section === 'inventory' ? 'active' : ''}`} onClick={() => setSection('inventory')}>
          <Package size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Inventory
        </button>
        <button className={`filter-chip ${section === 'kits' ? 'active' : ''}`} onClick={() => setSection('kits')}>
          <Layers size={12} style={{ marginRight: 5, verticalAlign: -1 }} />Kits
        </button>
      </div>

      {section === 'inventory' && (
        <ScanTools
          materials={materials}
          onStockIn={onStockIn}
          onAddNew={(prefill) => setEditing(prefill)}
        />
      )}

      {section === 'inventory' && (rows.length === 0 ? (
        <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
          <Package size={28} color="#ddd" style={{ marginBottom: 8 }} />
          <div>{filter === 'low' ? 'Nothing low on stock.' : 'No materials tracked yet.'}</div>
        </div>
      ) : (
        <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                {['Item', 'Category', 'Stock', 'Threshold', 'Unit Cost', 'Status', ''].map((h, i) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: i >= 2 && i <= 4 ? 'right' : 'left', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, severity }) => {
                const sm = SEVERITY_META[severity];
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700 }}>{m.name}</div>
                      {m.sku && <div style={{ fontSize: 11, color: '#aaa' }}>SKU: {m.sku}</div>}
                    </td>
                    <td style={{ padding: '12px 14px', color: '#666' }}>{m.category || '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>{m.stock_quantity} {m.unit}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#999' }}>{m.low_stock_threshold ?? '—'}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', color: '#666' }}>{m.unit_cost != null ? fmtMoney(m.unit_cost) : '—'}</td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: sm.bg, color: sm.color, whiteSpace: 'nowrap' }}>
                        {severity !== 'ok' && <AlertTriangle size={10} />} {sm.label}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button onClick={() => setEditing(m)} style={ICON_BTN}><Edit2 size={13} /></button>
                      <button onClick={() => { if (confirm(`Delete "${m.name}"?`)) onDelete(m.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {section === 'kits' && (
        <KitList
          kits={kits}
          onEdit={(k) => setEditingKit(k)}
          onDelete={onDeleteKit}
        />
      )}

      {editingKit && (
        <KitModal
          item={editingKit}
          materials={materials}
          onSave={async (k) => { await onSaveKit(k); setEditingKit(null); }}
          onClose={() => setEditingKit(null)}
        />
      )}

      {editing && (
        <MaterialModal
          item={editing}
          onSave={async (m) => { await onSave(m); setEditing(null); }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: '#888', marginLeft: 2,
};

// ─── Scanning into inventory ────────────────────────────────────────────────
//
// The Closeout tab's scanner records what a job CONSUMED. This one is the
// other direction: what came back from the store and goes on the shelf.
//
// Two doors, same as closeout: a receipt (photo, or pasted text which needs no
// AI at all), and a single item scanned off its barcode or shelf label. Both
// end in a review list — nothing touches stock until the numbers are agreed.

function ScanTools({
  materials, onStockIn, onAddNew,
}: {
  materials: Material[];
  onStockIn: (plan: StockInPlan) => Promise<void>;
  onAddNew: (prefill: Partial<Material>) => void;
}) {
  const [open, setOpen] = useState<'none' | 'receipt' | 'item'>('none');
  const [busy, setBusy] = useState(false);

  // Receipt → review rows
  const [receiptText, setReceiptText] = useState('');
  const [rows, setRows] = useState<StockInRow[]>([]);
  const [vendor, setVendor] = useState<string | null>(null);

  // Single item scan
  const [code, setCode] = useState('');
  const [found, setFound] = useState<Material | null>(null);
  const [searched, setSearched] = useState(false);
  const [scannedName, setScannedName] = useState<string | null>(null);
  const [scannedCost, setScannedCost] = useState<number | null>(null);

  const importReceipt = async (payload: { file?: File; text?: string }) => {
    setBusy(true);
    try {
      let res: Response;
      if (payload.file) {
        const fd = new FormData();
        fd.append('file', payload.file);
        res = await fetch('/api/materials/from-receipt', { method: 'POST', body: fd });
      } else {
        res = await fetch('/api/materials/from-receipt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: payload.text ?? '' }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toastError(data.error || 'Could not read that receipt'); return; }
      const matched = matchToInventory(data.items ?? [], materials);
      if (matched.length === 0) { toastError('No priced items found on that receipt'); return; }
      setRows(matched);
      setVendor(data.vendor ?? null);
      setReceiptText('');
      const known = matched.filter((r) => r.match).length;
      toastSuccess(matched.length + ' item' + (matched.length === 1 ? '' : 's') + ' read'
        + (known > 0 ? ' — ' + known + ' already in your inventory' : '') + '. Check the numbers, then add.');
    } catch {
      toastError('Could not read that receipt — check your connection');
    } finally {
      setBusy(false);
    }
  };

  // Live camera scan. canScanLive is resolved after mount, never during
  // render: touching navigator on the server would break the page outright.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scanRef = useRef<LiveScan | null>(null);
  const [liveOn, setLiveOn] = useState(false);
  const [canScanLive, setCanScanLive] = useState(false);
  useEffect(() => { setCanScanLive(supportsLiveScan()); }, []);

  const stopLive = () => {
    scanRef.current?.stop();
    scanRef.current = null;
    setLiveOn(false);
  };

  // Release the camera whatever happens — panel closed, tab switched, page
  // left. A light still on after the user has moved away is unforgivable.
  useEffect(() => () => { scanRef.current?.stop(); scanRef.current = null; }, []);
  useEffect(() => { if (open !== 'item') stopLive(); }, [open]);

  const lookup = (value: string) => {
    setSearched(true);
    setFound(findByCode(materials, value));
  };

  const startLive = async () => {
    setLiveOn(true);
    // Let React paint the <video> before handing it a stream.
    await new Promise((r) => setTimeout(r, 0));
    const el = videoRef.current;
    if (!el) { setLiveOn(false); return; }
    scanRef.current = await startLiveScan(
      el,
      (value) => {
        stopLive();
        setCode(value);
        lookup(value);
        toastSuccess('Barcode read: ' + value);
      },
      (message) => { stopLive(); toastError(message); },
    );
  };

  const scanItemPhoto = async (file: File) => {
    setBusy(true);
    setScannedName(null);
    setScannedCost(null);
    try {
      // On-device barcode first — no round trip, no AI cost.
      const local = await readBarcodeFromFile(file);
      if (local) {
        setCode(local);
        lookup(local);
        toastSuccess('Barcode read: ' + local);
        return;
      }
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/materials/scan-item', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toastError(data.error || 'Could not read that photo'); return; }
      const value = (data.code as string | null) ?? (data.name as string | null) ?? '';
      setCode(value);
      setScannedName((data.name as string | null) ?? null);
      setScannedCost((data.unit_cost as number | null) ?? null);
      lookup(value);
    } catch {
      toastError('Could not read that photo — check your connection');
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (id: string, patch: Partial<StockInRow>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const commit = async () => {
    const plan = planStockIn(rows);
    if (plan.topUps.length === 0 && plan.creates.length === 0) {
      toastError('Nothing ticked to add');
      return;
    }
    setBusy(true);
    try {
      await onStockIn(plan);
      setRows([]);
      setVendor(null);
      setOpen('none');
    } finally {
      setBusy(false);
    }
  };

  const plan = planStockIn(rows);

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, color: open === 'receipt' ? 'var(--teal)' : undefined }}
          onClick={() => setOpen((o) => (o === 'receipt' ? 'none' : 'receipt'))}
        >
          <Receipt size={13} /> Add from receipt
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 12, color: open === 'item' ? 'var(--teal)' : undefined }}
          onClick={() => setOpen((o) => (o === 'item' ? 'none' : 'item'))}
        >
          <ScanLine size={13} /> Scan an item
        </button>
      </div>

      {/* ── Receipt → stock ── */}
      {open === 'receipt' && (
        <div style={{ marginTop: 10, padding: '14px 16px', borderRadius: 10, border: '1.5px solid rgba(13,115,119,0.25)', background: 'rgba(13,115,119,0.03)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>
            Bought a load of stock? Use the camera, upload a screenshot or a saved PDF, or paste the
            emailed text. Anything you already track gets topped up; anything new becomes a new item.
            Nothing changes until you press Add to inventory.
          </div>
          {/* ONE button for all four ways in. Deliberately no `capture`: that
              attribute sends the phone straight to the camera and hides the
              gallery and Files, which is exactly wrong for a receipt that is
              already a screenshot or a saved PDF. Left off, the phone shows its
              own Camera / Photos / Files chooser and every case works. */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="btn btn-primary" style={{ fontSize: 12, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Camera size={13} /> {busy ? 'Reading…' : 'Scan or upload a receipt'}
              <input
                type="file" accept="image/*,application/pdf" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importReceipt({ file: f }); e.target.value = ''; }}
                style={{ display: 'none' }}
              />
            </label>
          </div>
          <textarea
            className="input" rows={3} value={receiptText}
            onChange={(e) => setReceiptText(e.target.value)}
            placeholder={'Or paste receipt text, e.g.\nCAT6 BOX 550MHZ  118.00\nKEYSTONE JACK  4 @ 2.99  11.96'}
            style={{ fontSize: 12, fontFamily: 'monospace' }}
          />
          <button
            type="button" className="btn btn-primary"
            disabled={busy || !receiptText.trim()}
            onClick={() => importReceipt({ text: receiptText })}
            style={{ fontSize: 12, alignSelf: 'flex-start', opacity: busy || !receiptText.trim() ? 0.6 : 1 }}
          >
            {busy ? 'Reading…' : 'Read items from text'}
          </button>
        </div>
      )}

      {/* ── Review before anything is written ── */}
      {rows.length > 0 && (
        <div style={{ marginTop: 10, padding: '14px 16px', borderRadius: 10, border: '1.5px solid rgba(13,115,119,0.35)', background: '#fff', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            Ready to add{vendor ? ' — from ' + vendor : ''}
          </div>
          {rows.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, flexWrap: 'wrap', opacity: r.include ? 1 : 0.45, background: r.match ? 'rgba(13,115,119,0.04)' : 'rgba(245,158,11,0.05)', border: '1px solid rgba(0,0,0,0.08)' }}>
              <input type="checkbox" checked={r.include} onChange={(e) => updateRow(r.id, { include: e.target.checked })} />
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                background: r.match ? 'rgba(13,115,119,0.12)' : 'rgba(245,158,11,0.15)',
                color: r.match ? 'var(--teal)' : '#92400e',
              }}>
                {r.match ? 'TOP UP' : 'NEW'}
              </span>
              <input
                className="input" value={r.name}
                onChange={(e) => updateRow(r.id, { name: e.target.value })}
                style={{ flex: '2 1 160px', fontSize: 13, padding: '7px 10px', fontWeight: 600 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                Qty
                <input className="input" type="number" min="0" step="1" value={r.quantity || ''}
                  onChange={(e) => updateRow(r.id, { quantity: Number(e.target.value) })}
                  style={{ width: 64, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                $ each
                <input className="input" type="number" min="0" step="0.01" value={r.unit_cost || ''}
                  onChange={(e) => updateRow(r.id, { unit_cost: Number(e.target.value) })}
                  style={{ width: 80, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
              </label>
              {r.match && (
                <span style={{ fontSize: 11, color: '#666' }}>
                  {r.match.stock_quantity} &rarr; <strong>{(Number(r.match.stock_quantity) || 0) + (Number(r.quantity) || 0)}</strong>
                </span>
              )}
              <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, marginLeft: 'auto' }}>
                <X size={13} />
              </button>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: '1px solid #f0f0f0', paddingTop: 10 }}>
            <span style={{ fontSize: 12, color: '#666' }}>
              {plan.topUps.length} topped up &middot; {plan.creates.length} new &middot; <strong>{fmtMoney(stockInCost(rows))}</strong>
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setRows([]); setVendor(null); }}>Discard</button>
              <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} disabled={busy} onClick={commit}>
                {busy ? 'Adding…' : 'Add to inventory'}
              </button>
            </span>
          </div>
        </div>
      )}

      {/* ── Scan one item ── */}
      {open === 'item' && (
        <div style={{ marginTop: 10, padding: '14px 16px', borderRadius: 10, border: '1.5px solid rgba(13,115,119,0.25)', background: 'rgba(13,115,119,0.03)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5 }}>
            Point the camera at a barcode to see whether you already stock it, and how many you have.
            Or type the number in.
          </div>

          {/* Live camera scan — reads the barcode on the phone itself, so it
              needs no key, costs nothing, and works with no signal. */}
          {liveOn && (
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#000' }}>
              <video ref={videoRef} style={{ width: '100%', maxHeight: 320, objectFit: 'cover', display: 'block' }} />
              <div style={{ position: 'absolute', inset: '18% 10%', border: '3px solid rgba(255,255,255,0.85)', borderRadius: 10, boxShadow: '0 0 0 9999px rgba(0,0,0,0.25)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.55)' }}>
                <span style={{ color: '#fff', fontSize: 12 }}>Hold the barcode inside the box…</span>
                <button type="button" className="btn btn-ghost" style={{ fontSize: 12, color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }} onClick={stopLive}>
                  Stop
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {canScanLive && !liveOn && (
              <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={startLive} disabled={busy}>
                <ScanLine size={13} /> Scan barcode
              </button>
            )}
            <label className="btn btn-ghost" style={{ fontSize: 12, cursor: busy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Paperclip size={13} /> {busy ? 'Reading…' : 'Scan or upload a photo'}
              <input
                type="file" accept="image/*,application/pdf" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) scanItemPhoto(f); e.target.value = ''; }}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              value={code}
              onChange={(e) => { setCode(e.target.value); setSearched(false); setFound(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(code); }}
              placeholder="or type a barcode / part number"
              style={{ flex: '1 1 200px', fontSize: 16 }}
            />
            <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => lookup(code)} disabled={!code.trim()}>
              Look up
            </button>
          </div>

          {searched && found && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{found.name}</div>
              <div style={{ fontSize: 12.5, color: '#444', marginTop: 4, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                <span>In stock: <strong>{found.stock_quantity} {found.unit || 'each'}</strong></span>
                {found.unit_cost != null && <span>Cost: <strong>{fmtMoney(found.unit_cost)}</strong></span>}
                {found.location && <span>Where: <strong>{found.location}</strong></span>}
                {found.sku && <span>SKU: {found.sku}</span>}
              </div>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => onAddNew(found)}>
                <Edit2 size={12} /> Open / adjust stock
              </button>
            </div>
          )}

          {searched && !found && code.trim() && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                Not in your inventory yet.
              </div>
              <button
                type="button" className="btn btn-primary" style={{ fontSize: 12 }}
                onClick={() => onAddNew({
                  sku: /^[0-9-]+$/.test(code.trim()) ? code.trim() : null,
                  name: scannedName ?? (/^[0-9-]+$/.test(code.trim()) ? '' : code.trim()),
                  unit_cost: scannedCost ?? 0,
                })}
              >
                <Plus size={12} /> Add it as a new item
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Kits ───────────────────────────────────────────────────────────────────
//
// A kit is the parts list for a job you do over and over — "camera drop",
// "AP install". Saved once here, then added whole to a job's closeout or to a
// quote, instead of typed out again every time.

function KitList({
  kits, onEdit, onDelete,
}: {
  kits: MaterialKit[];
  onEdit: (k: MaterialKit) => void;
  onDelete: (id: string) => void;
}) {
  if (kits.length === 0) {
    return (
      <div className="glass card" style={{ textAlign: 'center', padding: '56px 24px', color: '#aaa' }}>
        <Layers size={28} color="#ddd" style={{ marginBottom: 8 }} />
        <div style={{ marginBottom: 4, color: '#666', fontWeight: 600 }}>No kits saved yet.</div>
        <div style={{ fontSize: 13, maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
          Save the parts list for a job you do often — then add the whole list to a work order&apos;s
          Closeout tab, or price it into a quote, in one pick.
        </div>
      </div>
    );
  }

  const sorted = [...kits].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
      {sorted.map((k) => {
        const items = k.items ?? [];
        return (
          <div key={k.id} className="glass card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{k.name}</div>
                {k.description && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{k.description}</div>}
              </div>
              <div style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
                <button onClick={() => onEdit(k)} style={ICON_BTN}><Edit2 size={13} /></button>
                <button onClick={() => { if (confirm(`Delete the "${k.name}" kit? Jobs that already used it keep their materials.`)) onDelete(k.id); }} style={{ ...ICON_BTN, color: '#b91c1c' }}><Trash2 size={13} /></button>
              </div>
            </div>

            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: '#aaa' }}>Nothing in this kit yet</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: '#444' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <strong style={{ color: '#111' }}>{i.quantity}&times;</strong> {i.name || 'Unnamed item'}
                      {!i.material_id && <span style={{ fontSize: 10, fontWeight: 700, color: '#92400e', marginLeft: 6 }}>BUY</span>}
                    </span>
                    <span style={{ color: '#888', flexShrink: 0 }}>{fmtMoney((i.quantity || 0) * (i.unit_cost || 0))}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f0f0f0', paddingTop: 8, marginTop: 'auto' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {items.length} line{items.length !== 1 ? 's' : ''} &middot; at cost
              </span>
              <span style={{ fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(kitCost(items))}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KitModal({
  item, materials, onSave, onClose,
}: {
  item: Partial<MaterialKit>;
  materials: Material[];
  onSave: (k: Partial<MaterialKit>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<MaterialKit>>({ name: '', description: '', items: [], ...item });
  const items = form.items ?? [];
  const setItems = (next: MaterialKitItem[]) => setForm((f) => ({ ...f, items: next }));

  const addItem = (materialId: string | null) => {
    const mat = materialId ? materials.find((m) => m.id === materialId) ?? null : null;
    setItems([...items, newKitItem(mat)]);
  };
  const updateItem = (id: string, patch: Partial<MaterialKitItem>) =>
    setItems(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const removeItem = (id: string) => setItems(items.filter((i) => i.id !== id));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} {...backdropClose(onClose)}>
      <div className="glass card" style={{ width: 600, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? 'Edit Kit' : 'New Kit'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.5, marginBottom: 16 }}>
          The parts list for a job you do over and over. Saving a kit changes nothing on its own —
          stock only moves when a work order that used it is saved.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Kit Name (required)"><input className="input" value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Standard camera drop" autoFocus /></Field>
          <Field label="Description"><input className="input" value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="When you would use this kit" /></Field>

          <div>
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>What is in it</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <div style={{ position: 'relative', flex: '1 1 220px' }}>
                <select
                  className="select input"
                  value=""
                  onChange={(e) => { if (e.target.value) addItem(e.target.value); }}
                  style={{ fontSize: 12 }}
                >
                  <option value="">+ Add from inventory&hellip;</option>
                  {materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}{m.unit_cost ? ` · ${fmtMoney(m.unit_cost)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => addItem(null)}>
                <Plus size={13} /> Item you buy for the job
              </button>
            </div>

            {items.length === 0 ? (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: '#aaa', fontSize: 13, border: '1.5px dashed #e5e7eb', borderRadius: 10 }}>
                Nothing in this kit yet
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', borderRadius: 10, background: i.material_id ? 'rgba(13,115,119,0.04)' : 'rgba(245,158,11,0.05)', border: '1px solid rgba(0,0,0,0.08)', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: 0.5, padding: '2px 7px', borderRadius: 999, flexShrink: 0,
                      background: i.material_id ? 'rgba(13,115,119,0.12)' : 'rgba(245,158,11,0.15)',
                      color: i.material_id ? 'var(--teal)' : '#92400e',
                    }}>
                      {i.material_id ? 'STOCK' : 'BUY'}
                    </span>
                    <input
                      className="input"
                      value={i.name}
                      readOnly={!!i.material_id}
                      placeholder="Item name"
                      onChange={(e) => updateItem(i.id, { name: e.target.value })}
                      style={{ flex: '2 1 160px', fontSize: 13, padding: '7px 10px', background: i.material_id ? 'transparent' : undefined, border: i.material_id ? 'none' : undefined, fontWeight: 600 }}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      Qty
                      <input className="input" type="number" min="0" step="1" value={i.quantity || ''}
                        onChange={(e) => updateItem(i.id, { quantity: Number(e.target.value) })}
                        style={{ width: 64, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#888' }}>
                      $ each
                      <input className="input" type="number" min="0" step="0.01" value={i.unit_cost ?? ''} placeholder="0.00"
                        onChange={(e) => updateItem(i.id, { unit_cost: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ width: 80, fontSize: 12, padding: '6px 8px', textAlign: 'right' }} />
                    </label>
                    <button type="button" onClick={() => removeItem(i.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#aaa', padding: 4, flexShrink: 0 }}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', padding: '4px 10px' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase' }}>Kit cost</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(kitCost(items))}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => {
            if (!form.name?.trim()) { toastError('Give the kit a name first — it is the top field'); return; }
            onSave({ ...form, name: form.name.trim() });
          }}>Save Kit</button>
        </div>
      </div>
    </div>
  );
}

function MaterialModal({
  item, onSave, onClose,
}: {
  item: Partial<Material>;
  onSave: (m: Partial<Material>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<Material>>({
    name: '', description: '', category: '', unit: 'each', stock_quantity: 0,
    low_stock_threshold: 5, unit_cost: 0, supplier: '', sku: '', location: '', notes: '',
    ...item,
  });
  const set = <K extends keyof Material>(k: K, v: Material[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} {...backdropClose(onClose)}>
      <div className="glass card" style={{ width: 480, maxWidth: '90vw', maxHeight: '85vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.id ? 'Edit Material' : 'Add Material'}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999' }}><X size={18} /></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="Name (required)"><input className="input" value={form.name ?? ''} onChange={(e) => set('name', e.target.value)} placeholder="What the item is called" autoFocus /></Field>
          <Field label="Category"><input className="input" value={form.category ?? ''} onChange={(e) => set('category', e.target.value)} placeholder="e.g. electrical, plumbing" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Stock Quantity"><input className="input" type="number" value={form.stock_quantity ?? 0} onChange={(e) => set('stock_quantity', Number(e.target.value))} /></Field>
            <Field label="Unit"><input className="input" value={form.unit ?? ''} onChange={(e) => set('unit', e.target.value)} placeholder="each, ft, box..." /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Low Stock Threshold"><input className="input" type="number" value={form.low_stock_threshold ?? ''} onChange={(e) => set('low_stock_threshold', e.target.value === '' ? null : Number(e.target.value))} /></Field>
            <Field label="Unit Cost"><input className="input" type="number" step="0.01" value={form.unit_cost ?? 0} onChange={(e) => set('unit_cost', Number(e.target.value))} /></Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="SKU"><input className="input" value={form.sku ?? ''} onChange={(e) => set('sku', e.target.value)} /></Field>
            <Field label="Supplier"><input className="input" value={form.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} /></Field>
          </div>
          <Field label="Location"><input className="input" value={form.location ?? ''} onChange={(e) => set('location', e.target.value)} placeholder="Warehouse shelf, truck, etc." /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          {/* Deliberately NOT disabled. A greyed-out button that does nothing when
              clicked reads as "the app is broken" — say what is missing instead. */}
          <button className="btn btn-primary" onClick={() => {
            if (!form.name?.trim()) { toastError('Give the item a name first'); return; }
            onSave({ ...form, name: form.name.trim() });
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}
