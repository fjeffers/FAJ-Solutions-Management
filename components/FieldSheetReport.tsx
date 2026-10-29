'use client';
// The client's copy of a Field Sheet (Fred, 2026-10-24, of the Weekly Bill:
// "this need to be more user friendly"). What the client reads: the site, the
// dates, each tech's day on one line in plain words, the bill and the photos
// with captions a client understands. Built from the sheet as the office fixed
// it, so it never shows a raw tap ("Hotel → Hotel", 0 hours on site). Print or
// save as PDF; it prints alone (app/wf.css, body.job-log-open).
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { byTechRows, dayCalc, OFFICE, type SheetRow, type SheetSettings, type SheetTotals, type TechBreakdown } from '@/lib/field-sheet';
import ByTechTables from './ByTechTables';
import { expenseCategoryLabel } from '@/lib/expenses';
import { fmtMoney } from '@/lib/utils';

export type ReportPhoto = { src: string; title: string; caption: string };
export type ReportReceipt = { id: string; date: string; category: string; vendor: string | null; amount: number };

const NAVY = '#0E1B2E', GOLD = '#C9A24B', INK = '#1B1C1F', SUBTLE = '#5E6470', LINE = '#ECE8DF';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtLong = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const h = (n: number) => (n ? `${n.toFixed(2)} h` : '—');
const mi = (n: number) => (n ? `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} mi` : '—');

export default function FieldSheetReport({ site, client, wo, clientWo, address, from, to, rows, s, totals, perTech = [], receipts, photos, onClose }: {
  site: string; client: string; wo: string; clientWo: string | null; address: string; from: string; to: string;
  rows: SheetRow[]; s: SheetSettings; totals: SheetTotals;
  /** Each tech's hours, miles and materials (lib/field-sheet.ts byTech). */
  perTech?: TechBreakdown[];
  receipts: ReportReceipt[]; photos: { group: string; list: ReportPhoto[] }[];
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);
  // Only the days with work on them: a blank line means nothing to a client.
  const days = rows.filter((r) => !r.hidden).map((r) => ({ r, c: dayCalc(r.values, s.mileRate ?? 0) })).filter(({ r, c }) => c.worked || r.values.note);
  const dayCount = new Set(days.filter(({ c }) => c.hours > 0).map(({ r }) => r.day)).size;
  const cell: React.CSSProperties = { padding: '8px 10px', borderBottom: `1px solid ${LINE}`, textAlign: 'left', verticalAlign: 'top' };
  const num: React.CSSProperties = { ...cell, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
  const th = (t: string, right = false) => <th key={t} style={{ ...(right ? num : cell), fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: SUBTLE, fontWeight: 600 }}>{t}</th>;
  // The client sees only the materials on their bill, and the office's own receipts under FAJ's name.
  const techRows = byTechRows(perTech.map((t) => ({
    ...t, tech: t.tech === OFFICE ? 'FAJ Solutions' : t.tech, ...(t.materialsBilled ? {} : { materials: [], materialsTotal: 0 }),
  })), s.mileRate);
  const sub: React.CSSProperties = { fontSize: 13.5, fontWeight: 700, color: NAVY, margin: '14px 0 6px' };
  const H = ({ children }: { children: React.ReactNode }) => (
    <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: '26px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${GOLD}` }}>{children}</h2>
  );

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ flex: '1 1 200px' }}>Client report · {site}</b>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>

      <div className="jl-page" style={{ maxWidth: 900, margin: '0 auto', background: '#fff', color: INK, borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13.5, lineHeight: 1.5 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 52, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>FIELD SHEET</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>{from ? `${fmtLong(from)} – ${fmtLong(to || from)}` : 'Whole job'}</div>
          </div>
        </div>

        <div style={{ padding: '20px 26px 26px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>{site}</div>
          <div style={{ color: SUBTLE, marginTop: 2 }}>
            {[client && `Prepared for ${client}`, `Work order ${wo}`, clientWo && `Your reference ${clientWo}`].filter(Boolean).join(' · ')}
          </div>
          {address && <div style={{ color: SUBTLE }}>{address}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 18 }}>
            {[['Days on site', String(dayCount || '—')], ['Hours on site', h(totals.hours)], ['Travel', h(totals.travel)], ['Miles', mi(totals.miles)],
              ...(totals.bill ? [['Amount', fmtMoney(totals.bill)]] : [])].map(([k, v], i, all) => (
              <div key={k} className="jl-avoid" style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', background: i === all.length - 1 && totals.bill ? '#FBF6EA' : '#fff' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: SUBTLE }}>{k}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: NAVY, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              </div>
            ))}
          </div>

          {/* Fred, 2026-10-29: "each tech get their own break down": under each heading, each tech's days and total, then the next tech. */}
          <H>By technician</H>
          {techRows.length > 1 ? (
            <ByTechTables rows={techRows} heading={(title) => <h3 style={sub}>{title}</h3>}
              th={{ ...cell, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: SUBTLE, fontWeight: 600 }}
              td={cell} total={{ fontWeight: 700, background: '#FBF6EA' }} />
          ) : <div style={{ color: SUBTLE }}>No work recorded for these dates.</div>}

          {totals.lines.length > 0 && <>
            <H>The bill</H>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{th('Description')}{th('Qty', true)}{th('Rate', true)}{th('Amount', true)}</tr></thead>
              <tbody>{totals.lines.map((l, i) => (
                <tr key={i} className="jl-avoid"><td style={cell}>{l.description}</td><td style={num}>{l.qty}</td><td style={num}>{fmtMoney(l.rate)}</td><td style={num}>{fmtMoney(l.amount)}</td></tr>
              ))}</tbody>
              <tfoot><tr style={{ fontWeight: 700 }}><td style={cell} colSpan={3}>Total</td><td style={{ ...num, color: NAVY, fontSize: 15 }}>{fmtMoney(totals.bill)}</td></tr></tfoot>
            </table>
          </>}

          {/* By technician lists the hotel, meals and materials tech by tech; without it, the receipts as they came. */}
          {perTech.length === 0 && receipts.length > 0 && <>
            <H>Receipts</H>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>{th('Day')}{th('For')}{th('Where')}{th('Amount', true)}</tr></thead>
              <tbody>{receipts.map((e) => (
                <tr key={e.id} className="jl-avoid"><td style={{ ...cell, whiteSpace: 'nowrap' }}>{fmtDay(e.date)}</td><td style={cell}>{expenseCategoryLabel(e.category)}</td><td style={cell}>{e.vendor ?? ''}</td><td style={num}>{fmtMoney(e.amount)}</td></tr>
              ))}</tbody>
            </table>
          </>}

          {photos.filter((g) => g.list.length).map((g) => (
            <div key={g.group}>
              <H>{g.group}</H>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {g.list.map((p, i) => (
                  <figure key={i} className="jl-avoid" style={{ margin: 0, border: `1px solid ${LINE}`, borderRadius: 10, overflow: 'hidden' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.src} alt={p.caption || p.title} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }} />
                    <figcaption style={{ padding: '6px 10px', fontSize: 12 }}><b>{p.caption || p.title}</b>{p.caption && <div style={{ color: SUBTLE }}>{p.title}</div>}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 26, paddingTop: 10, borderTop: `1px solid ${LINE}`, color: SUBTLE, fontSize: 11.5 }}>
            FAJ Solutions · Times, places and miles come from the technicians&apos; phones and are checked by our office. Photos carry the time and GPS where they were taken.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
