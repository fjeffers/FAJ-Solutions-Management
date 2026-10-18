'use client';
// The job log (Fred, 2026-10-02: "can try job log"; idea from SimplySub's
// daily log). One clean page per job: each visit with times and GPS, the
// checklist, the answers to the job's questions, the tech's notes and the
// stamped photos — printed, or saved as a PDF from the print window, to send a
// client or marketplace as proof of work. No money anywhere on it. The scope
// of work starts switched off, because Fred sometimes notes pay in it.
//
// Fred, 2026-10-18: on a finished job, anything the tech didn't fill in is
// listed under "Not completed" (lib/job-gaps.ts), and empty parts are left out.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { buildVisits, inRange, logTotals, hoursText, dayOf, type Punch } from '@/lib/job-log';
import { mapLink } from '@/lib/geo';
import { jobGaps } from '@/lib/job-gaps';
import { isFinished, wfJobFromOwner } from '@/lib/wf';
import type { EnrichedWorkOrder, TimeLog } from '@/lib/types';

type PhotoRow = { id: string; url: string; taken_at: string; lat: number | null; lng: number | null; contractor_name: string | null };
type Include = { gaps: boolean; time: boolean; checklist: boolean; answers: boolean; notes: boolean; photos: boolean; scope: boolean };

const TZ = 'America/New_York';
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const fmtStamp = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: TZ });

/** A section heading on the printed page. */
const H = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 15, fontWeight: 700, color: '#0E1B2E', margin: '22px 0 8px', paddingBottom: 6, borderBottom: '2px solid #C9A24B' }}>{children}</h3>
);

export default function JobLogReport({ w, deliverables, onClose }: {
  w: EnrichedWorkOrder;
  /** The job's closeout deliverables (listFor), so a finished job can say which weren't done. */
  deliverables: string[];
  onClose: () => void;
}) {
  const [punches, setPunches] = useState<Punch[] | null>(null);
  const [logs, setLogs] = useState<TimeLog[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [inc, setInc] = useState<Include>({ gaps: true, time: true, checklist: true, answers: true, notes: true, photos: true, scope: false });

  useEffect(() => {
    const db = createClient();
    void Promise.all([
      db.from('job_punches').select('contractor_name, kind, at, lat, lng, accuracy').eq('wo_id', w.id).order('at'),
      db.from('wo_photos').select('id, url, taken_at, lat, lng, contractor_name').eq('wo_id', w.id).order('taken_at'),
      fetch(`/api/wo-time-logs?wo_id=${w.id}`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([p, ph, l]) => {
      setPunches(((p.data as Punch[] | null) ?? []));
      setPhotos(((ph.data as PhotoRow[] | null) ?? []));
      setLogs(Array.isArray(l) ? (l as TimeLog[]) : []);
    });
  }, [w.id]);

  // Printing shows only this report (app/wf.css, body.job-log-open).
  useEffect(() => {
    document.body.classList.add('job-log-open');
    return () => document.body.classList.remove('job-log-open');
  }, []);

  const visits = useMemo(() => buildVisits(punches ?? [], logs, new Date(), TZ).filter((v) => inRange(v.day, from, to)), [punches, logs, from, to]);
  const shownPhotos = photos.filter((p) => inRange(dayOf(p.taken_at, TZ), from, to));
  const totals = logTotals(visits);
  // Only a finished job has a "Not completed": on a job still going, it's just work still to do.
  const job = useMemo(() => wfJobFromOwner(w), [w]);
  // Waits for the photos to load, so it never says "No photos" too soon.
  const loaded = punches !== null;
  const gaps = useMemo(() => (loaded && isFinished(job) ? jobGaps(job, deliverables, photos.length) : []), [loaded, job, deliverables, photos.length]);
  const tasks = w.wo_tasks ?? [];
  const qa = w.custom_qa ?? [];
  const techs = (w.contractor_names?.length ? w.contractor_names : [w.contractor_name]).filter(Boolean);
  const where = [w.site_address, [w.site_city, [w.site_state, w.site_zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ');
  const isUrl = (v: string) => /^https?:\/\//.test(v);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: TZ });
  const range = from || to ? `${from ? fmtDay(from) : 'Start'} – ${to ? fmtDay(to) : 'today'}` : 'Whole job';

  const toggle = (k: keyof Include, label: string) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={inc[k]} onChange={(e) => setInc((s) => ({ ...s, [k]: e.target.checked }))} /> {label}
    </label>
  );

  const cell: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #ECE8DF', textAlign: 'left', verticalAlign: 'top' };

  return createPortal(
    <div id="job-log-root" className="wf" style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(2,4,9,0.55)', overflowY: 'auto', padding: '16px 12px 40px' }}>
      {/* Controls — never printed */}
      <div className="no-print" style={{ maxWidth: 850, margin: '0 auto 12px', background: '#F6F4EF', borderRadius: 14, padding: 14, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 16, flex: '1 1 160px' }}>Job log · WO {w.wo_number}</div>
        <label style={{ fontSize: 13 }}>From <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 13 }}>To <input type="date" className="wf-input" style={{ width: 150, minHeight: 36, padding: '4px 8px' }} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="wf-btn wf-btn-gold wf-btn-sm" onClick={() => window.print()}><Printer size={16} /> Print / Save as PDF</button>
        <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div style={{ flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', color: '#5E6470' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1B1C1F' }}>Show:</span>
          {gaps.length > 0 && toggle('gaps', 'Not completed')}{toggle('time', 'Time & GPS')}{toggle('checklist', 'Checklist')}{toggle('answers', 'Answers')}
          {toggle('notes', "Tech's notes")}{toggle('photos', 'Photos')}{toggle('scope', 'Scope of work')}
        </div>
      </div>

      {/* The report itself */}
      <div className="jl-page" style={{ maxWidth: 850, margin: '0 auto', background: '#fff', color: '#1B1C1F', borderRadius: 14, overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.3)', fontSize: 13 }}>
        <div className="jl-band" style={{ background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)', padding: '18px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ height: 54, width: 'auto' }} />
          <div style={{ textAlign: 'right', color: '#fff' }}>
            <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 1.5, color: '#E3C987' }}>JOB LOG</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>{range}</div>
          </div>
        </div>

        <div style={{ padding: '20px 24px 28px' }}>
          <div style={{ fontFamily: "'Playfair Display', Georgia, serif", fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{w.title || 'Work order'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '6px 20px', marginTop: 10 }}>
            {w.customer_name && <div><b>Client:</b> {w.customer_name}</div>}
            {w.external_wo_id && <div><b>Client WO #:</b> {w.external_wo_id}</div>}
            <div><b>FAJ WO #:</b> {w.wo_number}</div>
            {(w.site_name || where) && <div><b>Site:</b> {[w.site_name, where].filter(Boolean).join(' — ')}</div>}
            {(w.scheduled_date || w.start_date) && <div><b>Scheduled:</b> {fmtDay((w.scheduled_date || w.start_date)!.slice(0, 10))}</div>}
            {techs.length > 0 && <div><b>Technician{techs.length > 1 ? 's' : ''}:</b> {techs.join(', ')}</div>}
          </div>

          <div className="jl-avoid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, marginTop: 16 }}>
            {[
              ...(totals.ms > 0 ? [['Time on site', hoursText(totals.ms)]] : []),
              ...(totals.days > 0 ? [['Days', String(totals.days)]] : []),
              ...(shownPhotos.length > 0 ? [['Photos', String(shownPhotos.length)]] : []),
              ...(tasks.length ? [['Checklist', `${tasks.filter((t) => t.completed).length} of ${tasks.length}`]] : []),
              ...(qa.length ? [['Questions', `${qa.filter((q) => (q.answer ?? '').trim()).length} of ${qa.length}`]] : []),
            ].map(([label, value]) => (
              <div key={label} style={{ border: '1px solid #E4DFD3', borderRadius: 10, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: '#5E6470', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{label}</div>
                <div style={{ fontFamily: "'Space Grotesk', Inter, sans-serif", fontSize: 18, fontWeight: 700 }}>{value}</div>
              </div>
            ))}
          </div>

          {inc.gaps && gaps.length > 0 && (
            <>
              <H>Not completed</H>
              <div className="jl-avoid" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {gaps.map((g) => (
                  <div key={g.text} style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: '#B42318', fontWeight: 700, width: 16 }}>✗</span>
                    <span style={{ flex: 1 }}>{g.text}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {inc.scope && w.description && (<><H>Scope of work</H><div style={{ whiteSpace: 'pre-wrap' }}>{w.description}</div></>)}

          {inc.time && (punches === null || visits.length > 0) && (
            <>
              <H>Time on site</H>
              {punches === null ? <div style={{ color: '#5E6470' }}>Loading…</div>
                : (
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: '#F6F4EF' }}>
                      {['Date', 'Technician', 'In', 'Out', 'Hours', 'Location (GPS)'].map((h) => <th key={h} style={{ ...cell, fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {visits.map((v, i) => (
                        <tr key={i} className="jl-avoid">
                          <td style={cell}>{fmtDay(v.day)}</td>
                          <td style={cell}>{v.tech}</td>
                          <td style={cell}>{fmtTime(v.inAt)}</td>
                          <td style={cell}>{v.outAt ? fmtTime(v.outAt) : v.open ? 'On site now' : '—'}</td>
                          <td style={cell}>{hoursText(v.ms)}</td>
                          <td style={{ ...cell, fontSize: 12 }}>
                            {v.inGps ? <a href={mapLink(v.inGps.lat, v.inGps.lng)} target="_blank" rel="noopener noreferrer" style={{ color: '#0E1B2E' }}>{v.inGps.lat.toFixed(5)}, {v.inGps.lng.toFixed(5)}</a> : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
            </>
          )}

          {inc.checklist && tasks.length > 0 && (
            <>
              <H>Checklist</H>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {tasks.map((t) => (
                  <div key={t.id} className="jl-avoid" style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: t.completed ? '#047857' : '#9AA0AA', fontWeight: 700, width: 16 }}>{t.completed ? '✓' : '○'}</span>
                    <span style={{ flex: 1 }}>{t.label}</span>
                    <span style={{ color: '#5E6470', fontSize: 12 }}>{t.completed && t.completed_at ? fmtStamp(t.completed_at) : t.category}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {inc.answers && qa.length > 0 && (
            <>
              <H>Answers</H>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {qa.map((q) => {
                  const a = (q.answer ?? '').trim();
                  return (
                    <div key={q.id} className="jl-avoid">
                      <div style={{ fontWeight: 600 }}>{q.label}</div>
                      {!a ? <div style={{ color: '#9AA0AA' }}>Not answered</div>
                        : isUrl(a)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={a} alt={q.label} style={{ maxWidth: 260, maxHeight: 160, borderRadius: 6, border: '1px solid #E4DFD3', marginTop: 4 }} />
                          : <div style={{ whiteSpace: 'pre-wrap' }}>{a}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {inc.notes && (w.closeout_notes ?? '').trim() && (
            <><H>Technician&apos;s notes</H><div className="jl-avoid" style={{ whiteSpace: 'pre-wrap' }}>{w.closeout_notes}</div></>
          )}

          {inc.photos && shownPhotos.length > 0 && (
            <>
              <H>Photos</H>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                {shownPhotos.map((p) => (
                  <div key={p.id} className="jl-avoid">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${fmtStamp(p.taken_at)}`} style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 6, border: '1px solid #E4DFD3', display: 'block' }} />
                    <div style={{ fontSize: 11, color: '#5E6470', marginTop: 3 }}>
                      {fmtStamp(p.taken_at)}{p.contractor_name ? ` · ${p.contractor_name}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div style={{ marginTop: 28, paddingTop: 10, borderTop: '1px solid #E4DFD3', display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, color: '#5E6470', flexWrap: 'wrap' }}>
            <span><b style={{ color: '#0E1B2E' }}>FAJ Solutions</b> · Bringing People and Technology Together</span>
            <span>Prepared {today}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
