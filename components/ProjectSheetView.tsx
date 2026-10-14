'use client';

// The live project sheet page (/sheet/<token>, no login; migration 120).
// Fred, 2026-10-14: a Smartsheet-style log, one page per site (the job number
// decides the page), everyone on the site line by line with their name, new
// lines at the bottom as the techs work. The server hands over finished lines
// only (lib/project-sheet.ts); this file shows them, keeps the page fresh, and
// remembers the site picked in the address so a copied link opens it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtSheetDay, money2, openIssues, pageRows, type Sheet, type SheetMessage, type SheetRow } from '@/lib/project-sheet';
import { Bubble, Composer, useSheetMessages } from './SheetMessages';

const NAVY = '#0E1B2E';
const GOLD = '#C9A24B';
const LINE = '#E4DFD3';
const SUBTLE = '#5E6470';
const REFRESH_MS = 30_000;

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });

export default function ProjectSheetView({ sheet, messages: initialMessages, token, initialSite, initialTech, updatedAt }: {
  sheet: Sheet; messages: SheetMessage[]; token: string; initialSite: string | null; initialTech: string | null; updatedAt: string;
}) {
  const router = useRouter();
  // Open sites first, then the busiest.
  const sites = useMemo(() => [...sheet.sites].sort((a, b) =>
    Number(a.closed) - Number(b.closed) || b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name)), [sheet.sites]);
  const [siteWo, setSiteWo] = useState<string | null>(initialSite);
  const site = sites.find((s) => s.wo === siteWo) ?? sites[0] ?? null;
  const [tech, setTech] = useState<string | null>(initialTech);
  const shownTech = tech && site?.techs.includes(tech) ? tech : null;
  const rows = useMemo(() => (site ? pageRows(sheet, site.id, shownTech) : []), [sheet, site, shownTech]);
  const [photo, setPhoto] = useState<SheetRow | null>(null);
  // Messages: notes under lines, questions for the tech, "No access" (migration 121).
  const { messages, now, send } = useSheetMessages(token, initialMessages);
  const siteMsgs = useMemo(() => (site ? messages.filter((m) => m.wo === site.wo) : []), [messages, site]);
  const issues = site ? openIssues(messages, site.wo) : [];
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const crew = site ? [...new Set([...site.crew, ...site.techs])] : [];
  // The grid: the techs' lines and the site's own messages, in time order.
  type Item = { at: string; day: string; row?: SheetRow; msg?: SheetMessage };
  const items: Item[] = useMemo(() => {
    const msgs = siteMsgs.filter((m) => !m.rowRef && !m.parentId && (!shownTech || m.from === shownTech || m.to === shownTech));
    const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    return [...rows.map((r) => ({ at: r.at, day: r.day, row: r })), ...msgs.map((m) => ({ at: m.at, day: dayOf(m.at), msg: m }))]
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [rows, siteMsgs, shownTech]);

  // Keep the address in step with the page, so a copied link opens it.
  useEffect(() => {
    if (!site) return;
    const q = new URLSearchParams({ site: site.wo });
    if (shownTech) q.set('tech', shownTech);
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, [site, shownTech]);

  // Live: fetch fresh lines every 30 seconds and light up the new ones.
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, REFRESH_MS);
    const back = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [router]);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    const ids = sheet.rows.map((r) => r.id);
    if (seen.current) {
      const added = new Set(ids.filter((id) => !seen.current!.has(id)));
      if (added.size > 0) {
        setFresh(added);
        const t = window.setTimeout(() => setFresh(new Set()), 8000);
        seen.current = new Set(ids);
        return () => window.clearTimeout(t);
      }
    }
    seen.current = new Set(ids);
  }, [sheet.rows]);

  const csv = `/sheet/${token}/csv${site ? `?site=${encodeURIComponent(site.wo)}` : ''}`;

  return (
    <div className="ps-page">
      <style>{CSS}</style>
      <div className="ps-wrap">
        <div className="ps-brand ps-noprint">
          <div style={{ fontSize: 17, fontWeight: 800, color: NAVY, letterSpacing: 3 }}>FAJ SOLUTIONS</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8a6d2f', letterSpacing: 2 }}>LIVE PROJECT SHEET</div>
        </div>

        <div className="ps-head">
          <div style={{ fontSize: 22, fontWeight: 700 }}>{sheet.project}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="ps-dot" /> Live · updated {time(updatedAt)} · new lines appear as the technicians work
          </div>
        </div>

        <div className="ps-body">
          {sites.length === 0 && <div style={{ color: SUBTLE, padding: 8 }}>No sites on this project yet.</div>}

          {sites.length > 1 && (
            <div className="ps-tabs ps-noprint" role="tablist" aria-label="Sites">
              {sites.map((s) => (
                <button key={s.id} role="tab" aria-selected={s.id === site?.id} className={`ps-tab${s.id === site?.id ? ' on' : ''}`}
                  onClick={() => { setSiteWo(s.wo); setTech(null); }}>
                  <b>{s.name}</b>
                  <span>WO {s.wo}{s.closed ? ' · closed' : ''}</span>
                </button>
              ))}
            </div>
          )}

          {site && (
            <>
              <div className="ps-site">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: NAVY }}>{site.name}</div>
                  <span className={`ps-badge${site.closed ? ' closed' : ''}`}>{site.closed ? 'Site closed' : site.status || 'Open'}</span>
                </div>
                <div style={{ color: SUBTLE, fontSize: 13, marginTop: 2 }}>
                  {[site.address, `WO ${site.wo}`, site.clientWo ? `Client # ${site.clientWo}` : ''].filter(Boolean).join(' · ')}
                </div>
                <div className="ps-tiles">
                  {[
                    ['On site', site.techs.length ? site.techs.join(', ') : '—'],
                    ['Hours on site', String(site.onSiteHours)],
                    ['Miles', String(site.miles)],
                    ['Photos', String(site.photos)],
                    ['Receipts', money2(site.receiptTotal)],
                  ].map(([k, v]) => (
                    <div key={k} className="ps-tile"><div className="k">{k}</div><div className="v">{v}</div></div>
                  ))}
                </div>
              </div>

              {issues.map((m) => (
                <div key={m.id} className="ps-issue">
                  <Bubble m={m} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} />
                </div>
              ))}

              <div className="ps-noprint" style={{ marginTop: 12 }}>
                {composing
                  ? <Composer site={site.wo} techs={crew} send={send} onDone={() => setComposing(false)} label="Message the site" />
                  : <button className="ps-btn ps-btn-dark" onClick={() => setComposing(true)}>Message or ask the tech</button>}
              </div>

              <div className="ps-tools ps-noprint">
                {site.techs.length > 1 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    Show
                    <select value={shownTech ?? ''} onChange={(e) => setTech(e.target.value || null)} className="ps-select">
                      <option value="">Everyone on site</option>
                      {site.techs.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </label>
                )}
                <span style={{ flex: 1 }} />
                <a className="ps-btn" href={csv}>Download for Excel</a>
                <button className="ps-btn" onClick={() => window.print()}>Print / PDF</button>
                <button className="ps-btn" onClick={() => document.getElementById('ps-end')?.scrollIntoView({ behavior: 'smooth' })}>Latest ↓</button>
              </div>

              <table className="ps-grid">
                <thead>
                  <tr><th>Time</th><th>Technician</th><th>Activity</th><th>Location</th><th>Miles</th><th>Details</th><th>Photo</th></tr>
                </thead>
                <tbody>
                  {items.length === 0 && <tr><td colSpan={7} style={{ color: SUBTLE }}>Nothing recorded on this site yet.</td></tr>}
                  {items.map((it, n) => {
                    const newDay = n === 0 || items[n - 1].day !== it.day;
                    const dayRow = newDay ? <tr key={`d${it.day}`} className="ps-day"><td colSpan={7}>{fmtSheetDay(it.day)}</td></tr> : null;
                    if (it.msg) {
                      const m = it.msg;
                      return [dayRow, (
                        <tr key={m.id} className="ps-msgrow">
                          <td colSpan={7}><Bubble m={m} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} /></td>
                        </tr>
                      )];
                    }
                    const r = it.row!;
                    const notes = siteMsgs.filter((m) => m.rowRef === r.id && !m.parentId);
                    const extra = [r.details, r.amount != null ? money2(r.amount) : ''].filter(Boolean).join(' · ');
                    return [
                      dayRow,
                      <tr key={r.id} className={fresh.has(r.id) ? 'ps-fresh' : undefined}>
                        <td data-k="Time" className="ps-time">{r.time}</td>
                        <td data-k="Technician">{r.tech || '—'}</td>
                        <td data-k="Activity"><b>{r.activity}</b></td>
                        <td data-k="Location">{r.where}</td>
                        <td data-k="Miles">{r.miles != null ? r.miles : ''}</td>
                        <td data-k="Details">
                          {extra}
                          {r.receiptId && <> {extra ? '· ' : ''}<a href={`/sheet/${token}/receipt/${r.receiptId}`} target="_blank" rel="noopener noreferrer">Receipt</a></>}
                          <button className="ps-link ps-noprint" onClick={() => setNoteFor(noteFor === r.id ? null : r.id)}>
                            {r.kind === 'photo' ? 'Note or ask about this photo' : 'Note / ask'}
                          </button>
                        </td>
                        <td data-k="Photo">
                          {r.photo && (
                            <button className="ps-thumb" onClick={() => setPhoto(r)} aria-label={`Open the photo: ${r.activity}`}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={r.photo} alt="" loading="lazy" />
                            </button>
                          )}
                        </td>
                      </tr>,
                      notes.length > 0 || noteFor === r.id ? (
                        <tr key={`n${r.id}`} className="ps-notesrow">
                          <td colSpan={7}>
                            {notes.map((m) => <Bubble key={m.id} m={m} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} />)}
                            {noteFor === r.id && (
                              <Composer site={site.wo} techs={crew} kind={r.kind === 'photo' ? 'question' : 'note'} to={r.tech && crew.includes(r.tech) ? r.tech : ''}
                                rowRef={r.id} send={send} onDone={() => setNoteFor(null)} />
                            )}
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                </tbody>
              </table>
              <div id="ps-end" />

              {(site.notes || site.answers.length > 0 || site.checklist.total > 0) && (
                <div className="ps-notes">
                  <h3>Site report</h3>
                  {site.checklist.total > 0 && (
                    <p><b>{site.checklist.name}:</b> {site.checklist.done} of {site.checklist.total} done · {site.checklist.sign}</p>
                  )}
                  {site.checklist.cant.map(([item, why]) => <p key={item}>Could not do <b>{item}</b>: {why}</p>)}
                  {site.notes && <><div className="k">Notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{site.notes}</p></>}
                  {site.answers.length > 0 && <div className="k">Answers</div>}
                  {site.answers.map((a) => <p key={a.q}><b>{a.q}</b><br />{a.a}</p>)}
                </div>
              )}
            </>
          )}

          <div style={{ textAlign: 'center', fontSize: 11, color: '#9AA0AA', padding: '16px 0 2px' }}>
            FAJ Solutions · Bringing People and Technology Together. Times, places and miles come from the technician&apos;s phone.
          </div>
        </div>
      </div>

      {photo?.photo && (
        <div className="ps-lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={(e) => { if (e.target === e.currentTarget) setPhoto(null); }}>
          <div className="ps-lightbox-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.photo} alt={photo.activity} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{photo.activity}</b><br /><span style={{ color: SUBTLE }}>{photo.tech} · {fmtSheetDay(photo.day)} {photo.time}</span></span>
              <a className="ps-btn" href={photo.photo} target="_blank" rel="noopener noreferrer">Full size</a>
              <button className="ps-btn" onClick={() => setPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.ps-page{min-height:100vh;background:#f4f1ea;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1B1C1F;overflow-x:hidden}
.ps-wrap{max-width:1100px;margin:0 auto;overflow-wrap:anywhere}
.ps-brand{padding:0 4px 14px}
.ps-head{background:linear-gradient(135deg,${NAVY},#13284A);border-radius:16px 16px 0 0;color:#fff;padding:20px 22px}
.ps-dot{width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block;box-shadow:0 0 0 3px rgba(52,211,153,.25)}
.ps-body{background:#faf9f6;border-radius:0 0 16px 16px;border:1px solid #eee;border-top:none;padding:14px}
.ps-tabs{display:flex;gap:8px;overflow-x:auto;padding-bottom:10px;margin-bottom:6px}
.ps-tab{flex:0 0 auto;text-align:left;border:1px solid ${LINE};background:#fff;border-radius:10px;padding:8px 12px;cursor:pointer;font:inherit;display:flex;flex-direction:column;gap:2px;max-width:240px}
.ps-tab span{font-size:11px;color:${SUBTLE}}
.ps-tab.on{border-color:${NAVY};box-shadow:inset 0 -3px 0 ${GOLD}}
.ps-site{background:#fff;border:1px solid ${LINE};border-radius:12px;padding:14px 16px}
.ps-badge{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:2px 8px;border-radius:999px;background:rgba(16,185,129,.15);color:#047857}
.ps-badge.closed{background:#ECE8DF;color:${SUBTLE}}
.ps-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-top:12px}
.ps-tile{border:1px solid ${LINE};border-radius:10px;padding:8px 10px}
.ps-tile .k,.ps-notes .k{font-size:10px;font-weight:800;letter-spacing:1px;color:#999;text-transform:uppercase}
.ps-tile .v{font-size:16px;font-weight:800;color:${NAVY};margin-top:2px}
.ps-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0 8px}
.ps-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
.ps-select{font:inherit;font-size:16px;padding:5px 8px;border:1px solid ${LINE};border-radius:8px;background:#fff}
.ps-grid{width:100%;border-collapse:collapse;background:#fff;border:1px solid ${LINE};border-radius:12px;overflow:hidden}
.ps-grid th{background:${NAVY};color:#fff;text-align:left;white-space:nowrap;font-size:11px;letter-spacing:.5px;text-transform:uppercase;padding:8px 10px;position:sticky;top:0}
.ps-grid td{padding:8px 10px;border-top:1px solid #F0ECE3;font-size:13px;vertical-align:top}
.ps-grid tbody tr:nth-child(even):not(.ps-day){background:#FCFBF8}
.ps-day td{background:#F6F1E4!important;font-weight:800;color:${NAVY};font-size:12px;letter-spacing:.3px}
.ps-time{white-space:nowrap;color:${SUBTLE}}
.ps-fresh td{animation:psflash 8s ease-out}
@keyframes psflash{0%{background:#FBE9B8}100%{background:transparent}}
.ps-thumb{border:1px solid ${LINE};padding:0;border-radius:6px;overflow:hidden;cursor:zoom-in;background:#eee;width:84px;height:62px;display:block}
.ps-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ps-notes{background:#fff;border:1px solid ${LINE};border-radius:12px;padding:12px 16px;margin-top:12px;font-size:13.5px}
.ps-notes h3{margin:0 0 6px;font-size:14px;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:4px}
.ps-notes p{margin:4px 0}
.ps-input{font:inherit;font-size:16px;padding:6px 8px;border:1px solid ${LINE};border-radius:8px;background:#fff;min-width:0}
.ps-btn-dark{background:${NAVY};color:#fff}
.ps-btn:disabled{opacity:.5;cursor:default}
.ps-link{border:none;background:none;color:#1D4ED8;cursor:pointer;font:inherit;font-size:12px;padding:2px 0;display:block;text-align:left}
.ps-compose{background:#fff;border:1px solid ${LINE};border-radius:10px;padding:8px;margin-top:6px}
.ps-bubble{border-radius:10px;padding:8px 10px;font-size:13px;border:1px solid ${LINE};background:#fff;margin-top:4px}
.ps-bubble.tech{background:#EEF4FF;border-color:#C7D7FE}
.ps-bubble.client{background:#FFFBEB;border-color:#FDE68A}
.ps-bubble.waiting{background:#FEF3F2;border-color:#FDA29B}
.ps-issue{margin-top:12px}
.ps-msgrow td,.ps-notesrow td{background:#FCFBF8}
.ps-notesrow td{padding-left:24px}
.ps-lightbox{position:fixed;inset:0;background:rgba(14,27,46,.8);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}
.ps-lightbox-in{background:#fff;border-radius:12px;padding:12px;max-width:min(900px,100%);max-height:100%;overflow:auto}
.ps-lightbox-in img{max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:8px}
@media (max-width:700px){
  .ps-page{padding:16px 8px}
  .ps-grid thead{display:none}
  .ps-grid,.ps-grid tbody,.ps-grid tr,.ps-grid td{display:block;width:100%}
  .ps-grid tr:not(.ps-day){padding:8px 12px;border-top:1px solid #F0ECE3}
  .ps-grid td{border:none;padding:2px 0}
  .ps-grid td:empty{display:none}
  .ps-grid td[data-k="Miles"]:not(:empty)::after{content:" mi"}
  .ps-day td{padding:8px 12px}
  .ps-thumb{width:140px;height:104px;margin-top:4px}
}
@media print{
  .ps-noprint,.ps-lightbox{display:none!important}
  .ps-page{background:#fff;padding:0}
  .ps-grid th{position:static}
  .ps-grid tr{break-inside:avoid}
}
`;
