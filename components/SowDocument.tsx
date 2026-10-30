'use client';
// The Installer SOW for an LDS church site, under FAJ's name (Fred, 2026-10-29: "i want a template
// with this", from NetView's Installer SOW for LDS-1103 Fayetteville and the Vendor Guide v10.11.4).
// The site's boxes come filled in from the work order and can be changed before printing; the rest
// is the five days, the standards and the closeout from lib/lds-sow.ts. Print or save as PDF; it
// prints alone (app/wf.css, body.job-log-open), each day on its own page.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import {
  NETSPOT_MIN, SOW_CABLE_RUNS, SOW_CLOSEOUT, SOW_CONTACTS, SOW_DAYS, SOW_ESCALATION, SOW_OUT_OF_SCOPE,
  SOW_PRE_ARRIVAL, SOW_QUALITY_PHOTOS, SOW_REQUIRED_DOCS, SOW_SCHEDULE, SOW_SCOPE, SOW_STANDARDS, VENDOR_GUIDE,
  sowFields, sowFileName, type SowFields, type SowRow,
} from '@/lib/lds-sow';
import type { Contractor, EnrichedWorkOrder } from '@/lib/types';

const NAVY = '#0E1B2E', GOLD = '#C9A24B', INK = '#1B1C1F', SUBTLE = '#5E6470', LINE = '#ECE8DF', CREAM = '#FBF6EA';
/** The FAJ contact's name and phone, remembered on this device for the next SOW. */
const KEPT = 'faj-sow-contact';
const kept = (): { name?: string; phone?: string } => {
  try { return JSON.parse(localStorage.getItem(KEPT) ?? '{}') ?? {}; } catch { return {}; }
};

const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${LINE}`, textAlign: 'left', verticalAlign: 'top' };
const thStyle: React.CSSProperties = { ...cell, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: SUBTLE, fontWeight: 600, background: '#F6F4EF' };
const tick = <span aria-hidden style={{ display: 'inline-block', width: 12, height: 12, border: `1.5px solid ${SUBTLE}`, borderRadius: 2, flex: 'none', marginTop: 3 }} />;

const H = ({ children, page }: { children: React.ReactNode; page?: boolean }) => (
  <h2 style={{ fontSize: 16, fontWeight: 700, color: NAVY, margin: '24px 0 10px', paddingBottom: 6, borderBottom: `2px solid ${GOLD}`, ...(page ? { breakBefore: 'page' } : {}) }}>{children}</h2>
);
const Sub = ({ children }: { children: React.ReactNode }) => <h3 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY, margin: '14px 0 6px' }}>{children}</h3>;
const Callout = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="jl-avoid jl-band" style={{ background: CREAM, borderLeft: `4px solid ${GOLD}`, borderRadius: 6, padding: '8px 12px', margin: '10px 0' }}>
    <b style={{ color: NAVY }}>{title}.</b> {children}
  </div>
);

function Table({ head, rows, done, widths }: { head: string[]; rows: SowRow[]; done?: boolean; widths?: string[] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        {widths && <colgroup>{widths.map((w, i) => <col key={i} style={{ width: w }} />)}{done && <col style={{ width: 44 }} />}</colgroup>}
        {head.length > 0 && <thead><tr>{head.map((h) => <th key={h} style={thStyle}>{h}</th>)}{done && <th style={{ ...thStyle, textAlign: 'center' }}>Done</th>}</tr></thead>}
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="jl-avoid">
            {r.map((v, k) => <td key={k} style={{ ...cell, ...(k === 0 ? { fontWeight: 600, whiteSpace: head[0] === 'Time' ? 'nowrap' : undefined } : {}) }}>{v}</td>)}
            {done && <td style={{ ...cell, textAlign: 'center' }}>{tick}</td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const Ticks = ({ items }: { items: string[] }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {items.map((t) => <div key={t} className="jl-avoid" style={{ display: 'flex', gap: 8 }}>{tick}<span>{t}</span></div>)}
  </div>
);
const Bullets = ({ items }: { items: string[] }) => (
  <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{items.map((t) => <li key={t} className="jl-avoid" style={{ margin: '2px 0' }}>{t}</li>)}</ul>
);
const Signatures = ({ who }: { who: string[] }) => (
  <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px 24px', marginTop: 14 }}>
    {who.map((w) => (
      <div key={w} style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><div style={{ borderBottom: `1px solid ${INK}`, height: 24 }} /><div style={{ fontSize: 11, color: SUBTLE }}>{w}</div></div>
        <div style={{ width: 90 }}><div style={{ borderBottom: `1px solid ${INK}`, height: 24 }} /><div style={{ fontSize: 11, color: SUBTLE }}>Date</div></div>
      </div>
    ))}
  </div>
);

export default function SowDocument({ w, contractors, author, onClose }: {
  w: EnrichedWorkOrder; contractors: Contractor[];
  /** Who is signed in: the FAJ contact until it's changed. */
  author?: string;
  onClose: () => void;
}) {
  const [f, setF] = useState<SowFields>(() => {
    const k = kept();
    return sowFields(w, contractors, { name: k.name ?? author ?? '', phone: k.phone ?? '' });
  });
  const set = (k: keyof SowFields, v: string) => {
    setF((was) => ({ ...was, [k]: v }));
    if (k === 'fajContact' || k === 'fajPhone') {
      try { localStorage.setItem(KEPT, JSON.stringify({ ...kept(), [k === 'fajContact' ? 'name' : 'phone']: v })); } catch { /* the box still works */ }
    }
  };

  // Printing shows only this page, and the PDF takes the site's name.
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);
  const name = sowFileName(f);
  useEffect(() => {
    const was = document.title;
    document.title = name;
    return () => { document.title = was; };
  }, [name]);

  /** A fill-in box: the work order's value, changeable before printing. Called, not rendered as a component, so typing keeps focus. */
  const box = (label: string, k: keyof SowFields, span = 1) => (
    <label key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1, gridColumn: span > 1 ? `span ${span}` : undefined, minWidth: 0 }}>
      <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.5, color: SUBTLE, fontWeight: 600 }}>{label}</span>
      <input className="no-print" value={f[k]} onChange={(e) => set(k, e.target.value)} aria-label={label}
        style={{ border: 'none', borderBottom: '1px solid #C9C3B6', padding: '3px 0', font: 'inherit', fontSize: 13.5, color: INK, background: 'transparent', outline: 'none', minWidth: 0, width: '100%' }} />
      {/* On paper, the whole value wraps: a long access note or link isn't cut off at the box's width (Greptile on PR #34). */}
      <span className="jl-print-only" style={{ borderBottom: '1px solid #C9C3B6', padding: '3px 0', fontSize: 13.5, minHeight: 24, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{f[k]}</span>
    </label>
  );
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px 18px' };
  const where = [f.city, f.state].filter(Boolean).join(', ');

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      <div className="no-print" style={{ maxWidth: 900, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <b style={{ flex: '1 1 200px' }}>Installer SOW · WO {w.wo_number}</b>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div style={{ flexBasis: '100%', fontSize: 12.5, color: SUBTLE }}>
          The site&apos;s boxes are filled in from the work order. Type in any box to change it before you print; nothing is saved to the job. Your name and phone are remembered on this device.
        </div>
      </div>

      <div className="jl-page" style={{ maxWidth: 900, margin: '0 auto', background: '#fff', color: INK, borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13, lineHeight: 1.5 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 26px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 52, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>INSTALLER SOW</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>LDS meetinghouse network refresh · 5-day install</div>
          </div>
        </div>

        <div style={{ padding: '20px 26px 26px' }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: NAVY }}>
            {[f.ticket, f.siteId && `Site ${f.siteId}`].filter(Boolean).join(' · ') || 'LDS church install'}{where ? ` — ${where}` : ''}
          </div>
          <div style={{ color: SUBTLE, marginTop: 2 }}>FAJ Solutions for NetView Inc. · Follows the {VENDOR_GUIDE}</div>

          <H>Site</H>
          <div style={grid}>
            {box('Site ID', 'siteId')}{box('Ticket', 'ticket')}{box('FAJ WO #', 'faWo')}
            {box('Address', 'address', 2)}{box('City', 'city')}{box('State', 'state')}{box('Zip', 'zip')}
            {box('Start date', 'startDate')}{box('End date', 'endDate')}{box('Arrive', 'startTime')}
            {box('Lead tech', 'leadTech')}{box('Lead tech phone', 'leadPhone')}{box('Second tech', 'secondTech')}{box('Second tech phone', 'secondPhone')}
            {box('Lockbox / access', 'lockbox', 2)}{box('Floor plan style', 'floorplan')}
            {box('Gdrive deliverables link', 'deliverables', 2)}{box('Smartsheet checkout link', 'checkout', 2)}{box('Tools hub', 'tools', 2)}
            {box('FAJ contact', 'fajContact')}{box('FAJ phone', 'fajPhone')}
          </div>
          <Sub>Reimbursement</Sub>
          <div style={grid}>{box('Hotel ($ / night)', 'hotel')}{box('Meals ($ / day)', 'meals')}{box('Mileage ($ / mile)', 'mileage')}</div>

          <H>Purpose and scope</H>
          <p style={{ margin: '0 0 8px' }}>{SOW_SCOPE.purpose}</p>
          <Table head={[]} rows={SOW_SCOPE.facts} widths={['28%', '72%']} />
          <Sub>In scope</Sub>
          <Bullets items={SOW_SCOPE.inScope} />
          <Sub>Cable runs by system</Sub>
          <Table head={['System', 'Pull new Cat6A?', 'Jack / patch color']} rows={SOW_CABLE_RUNS} widths={['20%', '58%', '22%']} />

          <H>Contacts</H>
          <Table head={['Role', 'Name', 'Phone / email', 'Call for']}
            rows={[['FAJ Solutions', f.fajContact, f.fajPhone, 'Your first call: schedule, pay, materials, anything that blocks the day'], ...SOW_CONTACTS]} />
          <Callout title="Every day">Check in on the Teams chat on arrival with the crew&apos;s names, and check out with the Smartsheet form before leaving. A day without both is not paid.</Callout>

          <H>Before you arrive</H>
          <Callout title="No site package, no work">{SOW_PRE_ARRIVAL.rule}</Callout>
          {SOW_PRE_ARRIVAL.groups.map(([title, items]) => <div key={title}><Sub>{title}</Sub><Ticks items={items} /></div>)}
          <Sub>On Church property</Sub>
          <Bullets items={SOW_PRE_ARRIVAL.conduct} />

          <H>The five days</H>
          <Table head={['Day', 'Focus', 'Gate to start the next day']} rows={SOW_SCHEDULE} widths={['10%', '50%', '40%']} />

          {SOW_DAYS.map((d) => (
            <div key={d.n}>
              <H page>Day {d.n} — {d.title}</H>
              <p style={{ margin: '0 0 6px' }}>{d.intro}</p>
              {d.rule && <Callout title={d.rule.title}>{d.rule.text}</Callout>}
              <Sub>The day</Sub>
              <Table head={['Time', 'Activity', 'What to do', 'Output']} rows={d.activities} widths={['13%', '15%', '54%', '18%']} />
              <Sub>Deliverables</Sub>
              <Table head={['Deliverable', 'Format', 'Standard']} rows={d.deliverables} done widths={['24%', '20%', '56%']} />
              <Callout title="Gate">{d.gate}</Callout>
              <Sub>Day {d.n} sign-off</Sub>
              <Ticks items={d.signoff} />
              <Signatures who={['Lead tech', 'Second tech']} />
            </div>
          ))}

          <H page>Standards</H>
          <p style={{ margin: '0 0 6px' }}>{SOW_STANDARDS.colorNote}</p>
          <Sub>Workmanship</Sub><Bullets items={SOW_STANDARDS.workmanship} />
          <Sub>Labeling (standard of 10/22/2026)</Sub><Bullets items={SOW_STANDARDS.labeling} />
          <Sub>Demolition and returns</Sub><Bullets items={SOW_STANDARDS.demolition} />

          <H>Closeout</H>
          <Table head={['Item', 'Standard', 'When']} rows={SOW_CLOSEOUT} done widths={['22%', '58%', '20%']} />
          <Sub>Closeout photos (quality criteria)</Sub><Ticks items={SOW_QUALITY_PHOTOS} />
          <Sub>Required documents</Sub><Ticks items={SOW_REQUIRED_DOCS} />
          <Callout title="Wireless">Every meeting and teaching space reads {NETSPOT_MIN} or better on the NetSpot survey, or FAJ and the NetView PM hear about it before the crew leaves.</Callout>
          <Signatures who={['Lead tech', 'Second tech', 'FAJ Solutions']} />

          <H>Out of scope</H>
          <Bullets items={SOW_OUT_OF_SCOPE} />
          <H>Escalation</H>
          <Bullets items={SOW_ESCALATION} />

          <div style={{ marginTop: 26, paddingTop: 10, borderTop: `1px solid ${LINE}`, color: SUBTLE, fontSize: 11.5 }}>
            FAJ Solutions · {name} · Where this and NetView&apos;s SOW with CompuCom differ, the CompuCom SOW and its Exhibit B govern.
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
