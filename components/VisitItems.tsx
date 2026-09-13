'use client';
import { Plus, Trash2, Calendar } from 'lucide-react';
import { fmtMoney } from '@/lib/utils';
import { visitDays, visitBreakdown, type VisitDay } from '@/lib/visits';
import type { MaterialUsed, MileageLog, SiteVisit } from '@/lib/types';

/**
 * Every drive and every part on a site visit, one row each.
 *
 * The job this exists for, in Fred's words: "go to the site today but they
 * dont have meterials i have to buy meterials and return to finish the job."
 * That is one visit, two days, two round trips and a parts run in between —
 * and a visit used to have room for exactly one of each, so the detail that
 * justifies the bill was flattened before the client ever saw it.
 *
 * Each row carries the day it happened, which is what turns a pile of numbers
 * back into a story: drove out Monday, bought faceplates Tuesday, drove back
 * and finished Tuesday.
 */

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const cell: React.CSSProperties = { fontSize: 13, padding: '7px 8px' };
const head: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase',
  color: '#999', padding: '0 8px 5px',
};

function RowShell({ children, onRemove, title }: {
  children: React.ReactNode; onRemove: () => void; title: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      <button
        type="button" className="icon-btn" title={title} onClick={onRemove}
        style={{ color: '#b91c1c', flexShrink: 0 }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button" className="btn btn-ghost" onClick={onClick}
      style={{ marginTop: 7, fontSize: 12.5, padding: '8px 12px' }}
    >
      <Plus size={14} /> {label}
    </button>
  );
}

function Total({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      marginTop: 8, padding: '8px 11px', borderRadius: 9,
      background: 'rgba(13,115,119,0.07)', display: 'flex',
      alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
    }}>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--teal)', letterSpacing: 0.4 }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700 }}>
        {value}{sub && <span style={{ fontSize: 11.5, color: '#777', fontWeight: 600 }}> · {sub}</span>}
      </span>
    </div>
  );
}

// ── Billing breakdown ──────────────────────────────────────────────────────

/**
 * The visit's price taken apart — labor, travel, materials, other — with the
 * arithmetic spelled out on each line, live as the form is edited.
 *
 * Every number comes from lib/visits (the same helpers the statement and the
 * invoice builder use), so what this panel shows is exactly what will bill.
 * Zero lines stay visible: this is for checking the bill, and "Materials $0"
 * answers a question that hiding the row would leave open.
 */
export function VisitBillingBreakdown({ visit }: { visit: Partial<SiteVisit> }) {
  const b = visitBreakdown(visit as SiteVisit);
  return (
    <div style={{
      borderRadius: 10, border: '1.5px solid rgba(13,115,119,0.22)',
      background: 'rgba(13,115,119,0.04)', padding: '12px 14px',
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--teal)', marginBottom: 8 }}>
        Billing breakdown
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {b.lines.map((l) => (
          <div key={l.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: l.amount ? '#333' : '#9aa0a6', flexShrink: 0 }}>
              {l.label}
            </span>
            <span style={{ fontSize: 11.5, color: '#8a9096', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {l.detail}
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: l.amount ? '#1a1a1a' : '#b6bbc1', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
              {fmtMoney(l.amount)}
            </span>
          </div>
        ))}
      </div>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginTop: 9, paddingTop: 9, borderTop: '1.5px solid rgba(13,115,119,0.2)',
      }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--teal)', letterSpacing: 0.4 }}>VISIT TOTAL</span>
        <span style={{ fontSize: 17, fontWeight: 800, color: 'var(--teal)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtMoney(b.total)}
        </span>
      </div>
      {b.atMinimum && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: '#92400e', fontWeight: 600 }}>
          ⏱ 2-hour minimum applied — billing more hours than were logged.
        </div>
      )}
      {b.rateAmbiguous && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: '#b91c1c', fontWeight: 700 }}>
          ⚠ This rate bills ONCE as a flat fee even though hours are logged. If it should be
          per hour, switch the price to “/hr”.
        </div>
      )}
      {b.materialsUnticked > 0 && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: '#92400e', fontWeight: 600 }}>
          🧾 {fmtMoney(b.materialsUnticked)} of parts isn’t ticked “billed to client”, but it is
          still in this total — untick it here and it still bills.
        </div>
      )}
    </div>
  );
}

// ── Mileage ────────────────────────────────────────────────────────────────

export function MileageRows({ rows, defaultRate, defaultDate, onChange }: {
  rows: MileageLog[];
  /** The customer's rate, so a new trip is priced the way the rest are. */
  defaultRate: number;
  defaultDate: string | null;
  onChange: (rows: MileageLog[]) => void;
}) {
  const patch = (i: number, over: Partial<MileageLog>) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, ...over } : r)));

  const miles = rows.reduce((s, r) => s + (Number(r.miles) || 0), 0);
  const money = rows.reduce((s, r) => s + (Number(r.miles) || 0) * (Number(r.rate) || 0), 0);

  return (
    <div>
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.8fr 1.4fr', gap: 6 }}>
          <div style={head}>Day</div>
          <div style={head}>Miles</div>
          <div style={head}>$ / mi</div>
          <div style={head}>What for</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((r, i) => (
          <RowShell key={r.id} title="Remove this trip" onRemove={() => onChange(rows.filter((_, n) => n !== i))}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.8fr 0.8fr 1.4fr', gap: 6 }}>
              <input className="input" style={cell} type="date" value={(r.on ?? '').slice(0, 10)}
                onChange={(e) => patch(i, { on: e.target.value || null })} />
              <input className="input" style={cell} type="number" step="0.1" inputMode="decimal"
                value={r.miles ?? ''} placeholder="0"
                onChange={(e) => patch(i, { miles: e.target.value === '' ? 0 : Number(e.target.value) })} />
              <input className="input" style={cell} type="number" step="0.01" inputMode="decimal"
                value={r.rate ?? ''} placeholder="0.00"
                onChange={(e) => patch(i, { rate: e.target.value === '' ? 0 : Number(e.target.value) })} />
              <input className="input" style={cell} value={r.note ?? ''}
                placeholder="round trip, parts run…"
                onChange={(e) => patch(i, { note: e.target.value || null })} />
            </div>
          </RowShell>
        ))}
      </div>
      <AddRow label={rows.length === 0 ? 'Add a trip' : 'Add another trip'} onClick={() => onChange([
        ...rows,
        { id: newId(), contractor_name: '', miles: 0, rate: defaultRate, note: null, on: defaultDate },
      ])} />
      {rows.length > 0 && (
        <Total label="Travel billed" value={fmtMoney(money)} sub={`${miles.toFixed(0)} mi`} />
      )}
    </div>
  );
}

// ── Materials ──────────────────────────────────────────────────────────────

export function MaterialRows({ rows, defaultDate, onChange }: {
  rows: MaterialUsed[];
  defaultDate: string | null;
  onChange: (rows: MaterialUsed[]) => void;
}) {
  const patch = (i: number, over: Partial<MaterialUsed>) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, ...over } : r)));

  const cost = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0);
  const billed = rows
    .filter((r) => r.client_pays)
    .reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_cost) || 0), 0);

  return (
    <div>
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 0.8fr 1.1fr', gap: 6 }}>
          <div style={head}>Item</div>
          <div style={head}>Qty</div>
          <div style={head}>Each $</div>
          <div style={head}>Day bought</div>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r, i) => (
          <RowShell key={r.id} title="Remove this item" onRemove={() => onChange(rows.filter((_, n) => n !== i))}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.6fr 0.8fr 1.1fr', gap: 6 }}>
              <input className="input" style={cell} value={r.name ?? ''}
                placeholder="4U rack shelf, 300ft CAT6…"
                onChange={(e) => patch(i, { name: e.target.value })} />
              <input className="input" style={cell} type="number" step="1" inputMode="decimal"
                value={r.quantity ?? ''} placeholder="1"
                onChange={(e) => patch(i, { quantity: e.target.value === '' ? 0 : Number(e.target.value) })} />
              <input className="input" style={cell} type="number" step="0.01" inputMode="decimal"
                value={r.unit_cost ?? ''} placeholder="0.00"
                onChange={(e) => patch(i, { unit_cost: e.target.value === '' ? null : Number(e.target.value) })} />
              <input className="input" style={cell} type="date" value={(r.on ?? '').slice(0, 10)}
                onChange={(e) => patch(i, { on: e.target.value || null })} />
            </div>
            {/* Whether the client pays is per item, because it usually differs:
                the faceplates left on site are theirs, the tester is not. */}
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 5,
              fontSize: 11.5, color: '#666', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={!!r.client_pays}
                onChange={(e) => patch(i, { client_pays: e.target.checked })} />
              Client pays for this — it stays on site
            </label>
          </RowShell>
        ))}
      </div>
      <AddRow label={rows.length === 0 ? 'Add materials' : 'Add another item'} onClick={() => onChange([
        ...rows,
        { id: newId(), material_id: null, name: '', quantity: 1, unit_cost: null,
          client_pays: false, on: defaultDate },
      ])} />
      {rows.length > 0 && (
        <Total
          label="Materials"
          value={fmtMoney(cost)}
          sub={billed > 0 ? `${fmtMoney(billed)} billed to client` : 'none billed to client'}
        />
      )}
    </div>
  );
}

// ── The days a visit actually took ─────────────────────────────────────────

/**
 * Shown only when the work spilled over more than one day, because on a
 * single-day visit it would just repeat the totals above it.
 */
export function VisitDayBreakdown({ visit }: { visit: Partial<SiteVisit> }) {
  const days: VisitDay[] = visitDays(visit as SiteVisit);
  if (days.length < 2) return null;

  const dayLabel = (iso: string) =>
    new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short', month: 'numeric', day: 'numeric',
    });

  return (
    <div style={{
      marginTop: 10, padding: '11px 13px', borderRadius: 10,
      background: 'rgba(13,115,119,0.05)', border: '1px solid rgba(13,115,119,0.15)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
        fontSize: 11.5, fontWeight: 700, color: 'var(--teal)', letterSpacing: 0.4,
      }}>
        <Calendar size={13} /> {days.length} DAYS ON THIS JOB
      </div>
      {days.map((d) => (
        <div key={d.date} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10,
          padding: '5px 0', fontSize: 12.5, borderTop: '1px solid rgba(0,0,0,0.05)',
        }}>
          <span style={{ fontWeight: 700, minWidth: 78 }}>{dayLabel(d.date)}</span>
          <span style={{ color: '#666', textAlign: 'right' }}>
            {[
              d.hours > 0 ? `${d.hours}h` : null,
              d.miles > 0 ? `${d.miles.toFixed(0)} mi` : null,
              d.materials > 0 ? `${fmtMoney(d.materials)} parts` : null,
            ].filter(Boolean).join(' · ') || 'nothing logged'}
          </span>
        </div>
      ))}
    </div>
  );
}
