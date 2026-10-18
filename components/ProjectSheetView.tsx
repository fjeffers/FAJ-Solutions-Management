'use client';

// The live project sheet page (/sheet/<token>, no login; migration 120).
// Fred, 2026-10-14: "can we use the same setup as Smartsheet, this is what I
// thought I asked for". So it works like a Smartsheet sheet:
//   - a grid with row numbers, a frozen primary column (Activity), status
//     pills, a contact column with initials, and each day as a parent row
//     that folds open;
//   - every row has its conversation (💬) and attachments (📎); clicking a row
//     opens the side panel with its comments, questions and photos;
//   - a toolbar: the site (one sheet per job number), Grid / Cards views,
//     filter by tech, all conversations, Excel, Print, and alerts;
//   - Cards is a live board, one lane per tech with where they are now.
// The server hands over finished lines only (lib/project-sheet.ts). Alerts pop
// up and chime inside the sheet; phones can turn alerts on with no login.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  fmtSheetDay, initials, messageStatus, messageTitle, money2, openIssues, pageRows, rowStatus,
  type Sheet, type SheetMessage, type SheetRow, type Status,
} from '@/lib/project-sheet';
import { Bubble, Composer, savedName, useSheetMessages } from './SheetMessages';
import ProjectSheetReport, { REPORT_CSS } from './ProjectSheetReport';
import { ALERTS_CSS, AlertsButton, LiveToasts, chime, type Toast } from './SheetAlerts';

const NAVY = '#0E1B2E';
const GOLD = '#C9A24B';
const GRID = '#E1E4E8';
const SUBTLE = '#5E6470';
const REFRESH_MS = 30_000;
const TZ = 'America/New_York';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

/** One line of the grid: a tech's line, or a message that stands on its own. */
type Item = { key: string; at: string; day: string; row?: SheetRow; msg?: SheetMessage };
type Panel = { mode: 'row'; key: string } | { mode: 'all' } | { mode: 'photos' } | null;

function Pill({ s }: { s: Status }) {
  return <span className={`sg-pill t-${s.tone}`}><i />{s.label}</span>;
}

const AVATAR_COLORS = ['#2B6CB0', '#2E9E5B', '#B7791F', '#6B46C1', '#C53030', '#2C7A7B', '#DD6B20', '#0E1B2E'];
function Avatar({ name }: { name: string }) {
  if (!name) return <span className="sg-muted">—</span>;
  const n = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  return (
    <span className="sg-contact">
      <span className="sg-av" style={{ background: AVATAR_COLORS[n % AVATAR_COLORS.length] }}>{initials(name)}</span>
      <span className="sg-cname">{name}</span>
    </span>
  );
}

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
  const [view, setView] = useState<'grid' | 'cards'>('grid');
  const [panel, setPanel] = useState<Panel>(null);
  const [photo, setPhoto] = useState<SheetRow | null>(null);

  // Print report (Fred: "can print a completed, comprehensive report" ... "then no pdf").
  const [printing, setPrinting] = useState<{ all: boolean; at: Date } | null>(null);
  useEffect(() => {
    if (!printing) return;
    const t = window.setTimeout(() => window.print(), 300);
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printing]);

  // ── Alerts inside the sheet: a pop-up and a chime for each new line or message.
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [unseen, setUnseen] = useState(0);
  const announce = (items: Toast[]) => {
    if (items.length === 0) return;
    setToasts((t) => [...t, ...items].slice(-6));
    items.forEach((it) => window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== it.id)), 12_000));
    if (document.visibilityState !== 'visible') setUnseen((n) => n + items.length);
    chime();
  };
  useEffect(() => {
    const clear = () => { if (document.visibilityState === 'visible') setUnseen(0); };
    document.addEventListener('visibilitychange', clear);
    return () => document.removeEventListener('visibilitychange', clear);
  }, []);
  useEffect(() => { document.title = unseen > 0 ? `(${unseen}) Live project sheet` : 'Live project sheet'; }, [unseen]);

  // ── Messages: notes and questions on a row, "No access", replies (migration 121).
  const { messages, now, send } = useSheetMessages(token, initialMessages);
  const seenMsgs = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = messages.map((m) => m.id);
    if (seenMsgs.current) {
      const me = savedName();
      const added = messages.filter((m) => !seenMsgs.current!.has(m.id) && !(me && m.from === me && m.role === 'client'));
      announce(added.slice(-4).map((m) => ({
        id: `msg-${m.id}`, text: `${m.from}: ${messageTitle(m, messages)}`,
        sub: m.kind === 'issue' ? m.reason : m.body && m.kind !== 'resolved' ? m.body.slice(0, 120) : undefined,
      })));
    }
    seenMsgs.current = new Set(ids);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps
  const siteMsgs = useMemo(() => (site ? messages.filter((m) => m.wo === site.wo) : []), [messages, site]);
  const issues = site ? openIssues(messages, site.wo) : [];
  const crew = site ? [...new Set([...site.crew, ...site.techs])] : [];

  // ── The grid: lines and stand-alone messages, by day, oldest first.
  const items: Item[] = useMemo(() => {
    const msgs = siteMsgs.filter((m) => !m.rowRef && !m.parentId && !(m.kind === 'issue' && !m.resolvedAt)
      && (!shownTech || m.from === shownTech || m.to === shownTech));
    return [
      ...rows.map((r) => ({ key: r.id, at: r.at, day: r.day, row: r })),
      ...msgs.map((m) => ({ key: `m:${m.id}`, at: m.at, day: dayOf(m.at), msg: m })),
    ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [rows, siteMsgs, shownTech]);
  const days = useMemo(() => {
    const out: { day: string; items: Item[] }[] = [];
    for (const it of items) {
      const last = out[out.length - 1];
      if (last && last.day === it.day) last.items.push(it); else out.push({ day: it.day, items: [it] });
    }
    return out;
  }, [items]);
  // Older days fold up, like a Smartsheet parent row; the latest stays open.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (day: string) => open[day] ?? day === days[days.length - 1]?.day;
  const talkFor = (it: Item) => (it.row ? siteMsgs.filter((m) => m.rowRef === it.row!.id && !m.parentId) : siteMsgs.filter((m) => m.parentId === it.msg!.id));
  const photosOnSite = rows.filter((r) => r.photo);

  // Keep the address in step with the page, so a copied link opens it.
  useEffect(() => {
    if (!site) return;
    const q = new URLSearchParams({ site: site.wo });
    if (shownTech) q.set('tech', shownTech);
    window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`);
  }, [site, shownTech]);

  // Live: fresh lines every 30 seconds; new ones light up and pop up.
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
        announce(sheet.rows.filter((r) => added.has(r.id)).slice(-4).map((r) => ({
          id: `row-${r.id}`, text: `${r.tech ? `${r.tech} · ` : ''}${r.activity}`, sub: [r.site, r.time].filter(Boolean).join(' · '),
        })));
        const t = window.setTimeout(() => setFresh(new Set()), 8000);
        seen.current = new Set(ids);
        return () => window.clearTimeout(t);
      }
    }
    seen.current = new Set(ids);
  }, [sheet.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const csv = `/sheet/${token}/csv${site ? `?site=${encodeURIComponent(site.wo)}` : ''}`;
  const panelItem = panel?.mode === 'row' ? items.find((i) => i.key === panel.key) ?? null : null;
  const lineNo = (() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const d of days) { n += 1; map.set(`d:${d.day}`, n); if (isOpen(d.day)) for (const it of d.items) { n += 1; map.set(it.key, n); } }
    return map;
  })();

  const cells = (it: Item) => {
    const r = it.row;
    const m = it.msg;
    const s = r ? rowStatus(r) : messageStatus(m!);
    const talk = talkFor(it).length;
    const files = r?.photo || r?.receiptId ? 1 : 0;
    return {
      status: s, talk, files,
      activity: r ? r.activity : messageTitle(m!, siteMsgs),
      who: r ? r.tech : m!.from,
      when: r ? r.time : time(m!.at),
      where: r ? r.where : '',
      miles: r?.miles != null ? String(r.miles) : '',
      details: r ? [r.details, r.amount != null ? money2(r.amount) : ''].filter(Boolean).join(' · ')
        : m!.kind === 'issue' ? m!.reason : m!.kind === 'resolved' ? '' : m!.body,
    };
  };

  return (
    <div className="sg-page">
      <style>{CSS + REPORT_CSS + ALERTS_CSS}</style>
      <LiveToasts toasts={toasts} onClose={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />

      <div className="ps-screen">
        {/* App bar */}
        <header className="sg-appbar">
          <div className="sg-brand"><b>FAJ</b> Live Sheets</div>
          <div className="sg-title">{sheet.project}</div>
          <div className="sg-live"><span className="sg-dot" /> Live · {time(updatedAt)}</div>
          <AlertsButton token={token} />
        </header>

        {/* Toolbar */}
        <div className="sg-toolbar ps-noprint">
          {sites.length > 1 ? (
            <select className="sg-select sg-sheetpick" value={site?.wo ?? ''} onChange={(e) => { setSiteWo(e.target.value); setTech(null); setPanel(null); }} aria-label="Site">
              {sites.map((s) => <option key={s.id} value={s.wo}>{s.name} · WO {s.wo}{s.closed ? ' (closed)' : ''}</option>)}
            </select>
          ) : site && <span className="sg-sheetname">{site.name} · WO {site.wo}</span>}
          <span className="sg-seg" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'grid'} className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>▦ Grid</button>
            <button role="tab" aria-selected={view === 'cards'} className={view === 'cards' ? 'on' : ''} onClick={() => setView('cards')}>▤ Cards</button>
          </span>
          {site && site.techs.length > 1 && (
            <select className="sg-select" value={shownTech ?? ''} onChange={(e) => setTech(e.target.value || null)} aria-label="Filter">
              <option value="">Filter: everyone</option>
              {site.techs.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <span className="sg-spacer" />
          <button className="sg-tbtn sg-primary" onClick={() => setPanel({ mode: 'all' })}>💬 Message the tech{siteMsgs.length ? ` (${siteMsgs.length})` : ''}</button>
          <button className="sg-tbtn" onClick={() => setPanel({ mode: 'photos' })}>📎 {photosOnSite.length}</button>
          <a className="sg-tbtn" href={csv}>⤓ Excel</a>
          <button className="sg-tbtn" onClick={() => setPrinting({ all: false, at: new Date() })}>🖨 Print</button>
          {sites.length > 1 && <button className="sg-tbtn" onClick={() => setPrinting({ all: true, at: new Date() })}>🖨 All sites</button>}
        </div>

        {/* Sheet summary strip */}
        {site && (
          <div className="sg-summary">
            <span className={`sg-pill ${site.closed ? 't-gray' : 't-green'}`}><i />{site.closed ? 'Site closed' : site.status || 'Open'}</span>
            <span className="sg-sumtext">{[site.address, site.clientWo ? `Client # ${site.clientWo}` : ''].filter(Boolean).join(' · ')}</span>
            <span className="sg-kpis">
              <span><b>{site.onSiteHours}</b> hrs on site</span>
              <span><b>{site.miles}</b> mi</span>
              <span><b>{site.photos}</b> photos</span>
              <span><b>{money2(site.receiptTotal)}</b> receipts</span>
            </span>
          </div>
        )}

        {issues.map((m) => (
          <div key={m.id} className="sg-issue">
            <Bubble m={m} all={siteMsgs} now={now} site={site!.wo} techs={crew} send={send} />
          </div>
        ))}

        {sites.length === 0 && <div className="sg-empty">No sites on this project yet.</div>}

        {site && (
          <div className={`sg-main${panel ? ' with-panel' : ''}`}>
            <div className="sg-left">
              {view === 'grid' ? (
                <>
                  {/* Desktop grid */}
                  <div className="sg-scroll">
                    <table className="sg-grid">
                      <thead>
                        <tr>
                          <th className="c-num" />
                          <th className="c-icons" />
                          <th className="c-primary">Activity</th>
                          <th>Status</th>
                          <th>Technician</th>
                          <th>Time</th>
                          <th>Location</th>
                          <th className="c-mi">Miles</th>
                          <th>Details</th>
                          <th className="c-ph">Photo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {days.length === 0 && <tr><td colSpan={10} className="sg-muted" style={{ padding: 14 }}>Nothing recorded on this site yet.</td></tr>}
                        {days.map((d) => [
                          <tr key={`d${d.day}`} className="sg-parent" onClick={() => setOpen((o) => ({ ...o, [d.day]: !isOpen(d.day) }))}>
                            <td className="c-num">{lineNo.get(`d:${d.day}`)}</td>
                            <td className="c-icons" />
                            <td className="c-primary"><span className="sg-caret">{isOpen(d.day) ? '▾' : '▸'}</span> {fmtSheetDay(d.day)} <span className="sg-count">{d.items.length}</span></td>
                            <td colSpan={7} />
                          </tr>,
                          ...(isOpen(d.day) ? d.items.map((it) => {
                            const c = cells(it);
                            const sel = panel?.mode === 'row' && panel.key === it.key;
                            return (
                              <tr key={it.key} className={`sg-row${sel ? ' sel' : ''}${it.row && fresh.has(it.row.id) ? ' fresh' : ''}${it.msg ? ' msg' : ''}`}
                                onClick={() => setPanel({ mode: 'row', key: it.key })}>
                                <td className="c-num">{lineNo.get(it.key)}</td>
                                <td className="c-icons">
                                  <span className={`sg-ic${c.talk ? ' has' : ''}`} title="Conversation">💬{c.talk ? c.talk : ''}</span>
                                  {c.files > 0 && <span className="sg-ic has" title="Attachment">📎</span>}
                                </td>
                                <td className="c-primary"><span className="sg-indent" />{c.activity}</td>
                                <td><Pill s={c.status} /></td>
                                <td><Avatar name={c.who} /></td>
                                <td className="sg-nowrap">{c.when}</td>
                                <td>{c.where}</td>
                                <td className="c-mi">{c.miles}</td>
                                <td className="sg-details">{c.details}</td>
                                <td className="c-ph" onClick={(e) => { if (it.row?.photo) { e.stopPropagation(); setPhoto(it.row); } }}>
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  {it.row?.photo && <img className="sg-thumb" src={it.row.photo} alt="" loading="lazy" />}
                                </td>
                              </tr>
                            );
                          }) : []),
                        ])}
                      </tbody>
                    </table>
                  </div>

                  {/* Phone list: same rows as cards */}
                  <div className="sg-mlist">
                    {days.length === 0 && <div className="sg-muted" style={{ padding: 14 }}>Nothing recorded on this site yet.</div>}
                    {days.map((d) => (
                      <div key={d.day}>
                        <button className="sg-mday" onClick={() => setOpen((o) => ({ ...o, [d.day]: !isOpen(d.day) }))}>
                          <span>{isOpen(d.day) ? '▾' : '▸'} {fmtSheetDay(d.day)}</span><span className="sg-count">{d.items.length}</span>
                        </button>
                        {isOpen(d.day) && d.items.map((it) => {
                          const c = cells(it);
                          return (
                            <button key={it.key} className={`sg-mrow${it.row && fresh.has(it.row.id) ? ' fresh' : ''}`} onClick={() => setPanel({ mode: 'row', key: it.key })}>
                              <span className="sg-mtop"><Pill s={c.status} /><span className="sg-muted">{c.when}</span>{c.talk > 0 && <span className="sg-ic has">💬{c.talk}</span>}</span>
                              <b className="sg-mact">{c.activity}</b>
                              <span className="sg-mmeta">{[c.who, c.where, c.miles ? `${c.miles} mi` : '', c.details].filter(Boolean).join(' · ')}</span>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {it.row?.photo && <img className="sg-mthumb" src={it.row.photo} alt="" loading="lazy" />}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <CardsBoard techs={crew.filter((t) => !shownTech || t === shownTech)} rows={rows} msgs={siteMsgs}
                  onOpen={(key) => setPanel({ mode: 'row', key })} />
              )}

              {(site.notes || site.answers.length > 0 || site.checklist.total > 0 || site.missing.length > 0) && (
                <div className="sg-sheetsum">
                  <h3>Sheet summary</h3>
                  {site.checklist.total > 0 && (
                    <p><b>{site.checklist.name}:</b> {site.checklist.done} of {site.checklist.total} done{site.checklist.sign ? ` · ${site.checklist.sign}` : ''}</p>
                  )}
                  {site.missing.length > 0 ? (
                    <>
                      <div className="k" style={{ color: '#B42318' }}>Not completed</div>
                      {site.missing.map((m) => <p key={m}>✗ {m}</p>)}
                    </>
                  ) : site.checklist.cant.map(([item, why]) => <p key={item}>Could not do <b>{item}</b>: {why}</p>)}
                  {site.notes && <><div className="k">Notes</div><p style={{ whiteSpace: 'pre-wrap' }}>{site.notes}</p></>}
                  {site.answers.length > 0 && <div className="k">Answers</div>}
                  {site.answers.map((a) => <p key={a.q}><b>{a.q}</b><br />{a.a}</p>)}
                </div>
              )}
            </div>

            {/* Side panel: a row's conversation and attachments, or the whole site's */}
            {panel && (
              <aside className="sg-panel" aria-label="Conversation">
                <div className="sg-phead">
                  <b style={{ flex: 1, minWidth: 0 }}>
                    {panel.mode === 'all' ? 'Conversations' : panel.mode === 'photos' ? `Attachments (${photosOnSite.length})`
                      : panelItem ? `Row ${lineNo.get(panelItem.key) ?? ''} · ${cells(panelItem).activity}` : 'Row'}
                  </b>
                  <button className="sg-x" aria-label="Close" onClick={() => setPanel(null)}>×</button>
                </div>
                <div className="sg-pbody">
                  {panel.mode === 'all' && (
                    <>
                      <Composer site={site.wo} techs={crew} send={send} label="Message or ask the tech" />
                      <div className="k" style={{ marginTop: 12 }}>All conversations on this site</div>
                      {siteMsgs.filter((m) => !m.parentId).length === 0 && <p className="sg-muted">No messages yet.</p>}
                      {[...siteMsgs].filter((m) => !m.parentId).reverse().map((m) => (
                        <Bubble key={m.id} m={m} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} />
                      ))}
                    </>
                  )}
                  {panel.mode === 'photos' && (
                    <div className="sg-photos">
                      {photosOnSite.length === 0 && <p className="sg-muted">No photos yet.</p>}
                      {photosOnSite.map((r) => (
                        <button key={r.id} className="sg-pcard" onClick={() => setPanel({ mode: 'row', key: r.id })}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={r.photo!} alt="" loading="lazy" />
                          <span><b>{r.activity.replace('Took a photo: ', '').replace('Took a photo', 'Photo')}</b><br />{r.tech} · {r.time}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {panel.mode === 'row' && panelItem && (
                    <>
                      <div className="sg-pmeta">
                        <Pill s={cells(panelItem).status} />
                        <span>{cells(panelItem).who}</span>
                        <span className="sg-muted">{fmtSheetDay(panelItem.day)} · {cells(panelItem).when}</span>
                      </div>
                      {cells(panelItem).where && <p className="sg-muted" style={{ margin: '6px 0' }}>{cells(panelItem).where}</p>}
                      {panelItem.row?.photo && (
                        <button className="sg-pbig" onClick={() => setPhoto(panelItem.row!)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={panelItem.row.photo} alt={panelItem.row.activity} />
                        </button>
                      )}
                      {panelItem.row?.receiptId && (
                        <p><a href={`/sheet/${token}/receipt/${panelItem.row.receiptId}`} target="_blank" rel="noopener noreferrer">📎 Open the receipt</a></p>
                      )}
                      {panelItem.msg ? (
                        <Bubble m={panelItem.msg} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} />
                      ) : (
                        <>
                          <div className="k" style={{ marginTop: 10 }}>Conversation</div>
                          {talkFor(panelItem).length === 0 && <p className="sg-muted" style={{ margin: '4px 0' }}>No comments on this row yet.</p>}
                          {talkFor(panelItem).map((m) => <Bubble key={m.id} m={m} all={siteMsgs} now={now} site={site.wo} techs={crew} send={send} />)}
                          <Composer key={panelItem.key} site={site.wo} techs={crew}
                            kind={panelItem.row?.kind === 'photo' ? 'question' : 'note'}
                            to={panelItem.row?.tech && crew.includes(panelItem.row.tech) ? panelItem.row.tech : ''}
                            rowRef={panelItem.row!.id} send={send} label="Comment or ask about this row" />
                        </>
                      )}
                    </>
                  )}
                </div>
              </aside>
            )}
          </div>
        )}

        <div className="sg-foot">
          FAJ Solutions · Bringing People and Technology Together. Times, places and miles come from the technician&apos;s phone.
        </div>
      </div>

      <ProjectSheetReport sheet={sheet} messages={messages}
        sites={printing?.all ? sites : site ? [site] : []} printedAt={printing?.at ?? new Date(updatedAt)} />

      {photo?.photo && (
        <div className="ps-lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={(e) => { if (e.target === e.currentTarget) setPhoto(null); }}>
          <div className="ps-lightbox-in">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.photo} alt={photo.activity} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <span style={{ flex: 1, minWidth: 0 }}><b>{photo.activity}</b><br /><span style={{ color: SUBTLE }}>{photo.tech} · {fmtSheetDay(photo.day)} {photo.time}</span></span>
              <a className="sg-tbtn" href={photo.photo} target="_blank" rel="noopener noreferrer">Full size</a>
              <button className="sg-tbtn" onClick={() => setPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Cards: a lane per tech — where they are now, and their latest lines. */
function CardsBoard({ techs, rows, msgs, onOpen }: {
  techs: string[]; rows: SheetRow[]; msgs: SheetMessage[]; onOpen: (key: string) => void;
}) {
  if (techs.length === 0) return <div className="sg-muted" style={{ padding: 14 }}>No technicians on this site yet.</div>;
  return (
    <div className="sg-board">
      {techs.map((t) => {
        const mine = rows.filter((r) => r.tech === t);
        const last = mine[mine.length - 1];
        const stopped = msgs.find((m) => m.kind === 'issue' && !m.resolvedAt && m.from === t);
        const now = stopped ? messageStatus(stopped) : last ? rowStatus(last) : { label: 'Not started', tone: 'gray' as const };
        return (
          <section key={t} className="sg-lane">
            <div className="sg-lanehead">
              <Avatar name={t} />
              <Pill s={now} />
              {last && <span className="sg-muted" style={{ fontSize: 12 }}>since {last.time}</span>}
            </div>
            {stopped && <div className="sg-card stop"><b>{stopped.body}</b><span>{stopped.reason}</span></div>}
            {[...mine].reverse().slice(0, 12).map((r) => (
              <button key={r.id} className="sg-card" onClick={() => onOpen(r.id)}>
                <span className="sg-mtop"><Pill s={rowStatus(r)} /><span className="sg-muted">{r.time}</span></span>
                <b>{r.activity}</b>
                {r.where && <span className="sg-muted">{r.where}</span>}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {r.photo && <img src={r.photo} alt="" loading="lazy" />}
              </button>
            ))}
            {mine.length === 0 && <div className="sg-muted" style={{ padding: 8, fontSize: 13 }}>Nothing yet today.</div>}
          </section>
        );
      })}
    </div>
  );
}

const CSS = `
.sg-page{min-height:100vh;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#1B1C1F;overflow-x:hidden}
.sg-appbar{display:flex;align-items:center;gap:14px;background:${NAVY};color:#fff;padding:10px 16px;flex-wrap:wrap}
.sg-brand{font-size:14px;letter-spacing:.5px;white-space:nowrap}
.sg-brand b{background:${GOLD};color:${NAVY};border-radius:4px;padding:1px 6px;margin-right:4px}
.sg-title{font-size:17px;font-weight:700;flex:1;min-width:160px}
.sg-live{font-size:12px;opacity:.85;display:flex;align-items:center;gap:6px;white-space:nowrap}
.sg-dot{width:8px;height:8px;border-radius:50%;background:#34d399;display:inline-block;box-shadow:0 0 0 3px rgba(52,211,153,.25)}
.sg-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:#fff;border-bottom:1px solid ${GRID};padding:8px 12px}
.sg-sheetname{font-weight:700;color:${NAVY};font-size:14px}
.sg-select{font:inherit;font-size:14px;padding:6px 8px;border:1px solid #CBD2D9;border-radius:6px;background:#fff;max-width:100%}
.sg-sheetpick{font-weight:700;color:${NAVY}}
.sg-seg{display:inline-flex;border:1px solid #CBD2D9;border-radius:6px;overflow:hidden}
.sg-seg button{border:none;background:#fff;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;color:${SUBTLE}}
.sg-seg button.on{background:#E8F0FB;color:${NAVY};font-weight:700}
.sg-spacer{flex:1}
.sg-tbtn{border:1px solid #CBD2D9;background:#fff;color:#1B1C1F;border-radius:6px;padding:6px 10px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap;display:inline-block}
.sg-tbtn:hover{background:#F5F7FA}
.sg-primary{background:${NAVY};border-color:${NAVY};color:#fff}
.sg-primary:hover{background:#1A2E4A}
.sg-summary{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border-bottom:1px solid ${GRID};padding:8px 14px;font-size:13px}
.sg-sumtext{color:${SUBTLE};flex:1;min-width:160px}
.sg-kpis{display:flex;gap:14px;flex-wrap:wrap;color:${SUBTLE}}
.sg-kpis b{color:${NAVY}}
.sg-issue{margin:10px 12px 0}
.sg-empty{padding:20px;color:${SUBTLE}}
.sg-main{display:flex;align-items:flex-start;gap:0}
.sg-left{flex:1;min-width:0;padding:10px 12px}
.sg-scroll{overflow:auto;max-height:calc(100vh - 210px);min-height:320px;background:#fff;border:1px solid ${GRID};border-radius:6px}
.sg-grid{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;font-size:13px}
.sg-grid th{position:sticky;top:0;z-index:3;background:#F5F6F8;color:#3A4250;font-weight:700;text-align:left;padding:7px 10px;border-bottom:1px solid #CBD2D9;border-right:1px solid ${GRID};white-space:nowrap}
.sg-grid td{padding:6px 10px;border-bottom:1px solid ${GRID};border-right:1px solid ${GRID};vertical-align:middle;background:#fff;max-width:320px}
.sg-grid .c-num{position:sticky;left:0;z-index:2;width:38px;min-width:38px;text-align:center;color:#8A94A3;background:#F5F6F8;font-size:12px;padding:6px 4px}
.sg-grid th.c-num{z-index:4}
.sg-grid .c-icons{width:56px;min-width:56px;white-space:nowrap;padding:6px 4px}
.sg-grid .c-primary{position:sticky;left:38px;z-index:2;min-width:250px;max-width:300px;font-weight:600;box-shadow:1px 0 0 #CBD2D9}
.sg-grid th.c-primary{z-index:4;background:#F5F6F8}
.sg-grid .c-mi{width:56px;text-align:right}
.sg-grid .c-ph{width:70px}
.sg-row{cursor:pointer}
.sg-row:hover td{background:#F7FAFF}
.sg-row:hover td.c-num{background:#EEF2F7}
.sg-row.sel td{background:#E6F0FB!important}
.sg-row.msg td.c-primary{font-style:italic}
.sg-row.fresh td{animation:sgflash 8s ease-out}
@keyframes sgflash{0%{background:#FBE9B8}100%{background:#fff}}
.sg-parent{cursor:pointer}
.sg-parent td{background:#EEF1F5;font-weight:700;color:${NAVY}}
.sg-parent td.c-primary{background:#EEF1F5}
.sg-caret{display:inline-block;width:14px;color:#3A4250}
.sg-count{display:inline-block;margin-left:6px;font-size:11px;font-weight:700;background:#fff;border:1px solid #CBD2D9;border-radius:999px;padding:0 7px;color:${SUBTLE}}
.sg-indent{display:inline-block;width:16px}
.sg-ic{font-size:12px;opacity:.35;margin-right:4px}
.sg-ic.has{opacity:1;color:${NAVY};font-weight:700}
.sg-nowrap{white-space:nowrap}
.sg-details{color:#3A4250}
.sg-muted{color:#8A94A3}
.sg-thumb{width:52px;height:38px;object-fit:cover;border-radius:4px;border:1px solid ${GRID};display:block;cursor:zoom-in}
.sg-pill{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:2px 9px 2px 7px;font-size:12px;font-weight:700;white-space:nowrap}
.sg-pill i{width:8px;height:8px;border-radius:50%;display:inline-block}
.t-green{background:#E3F4EA;color:#1F6B3F}.t-green i{background:#2E9E5B}
.t-blue{background:#E4EEF9;color:#1E4E86}.t-blue i{background:#2B6CB0}
.t-navy{background:#E3E7EE;color:${NAVY}}.t-navy i{background:${NAVY}}
.t-amber{background:#FDF3D8;color:#8A5A00}.t-amber i{background:#D69E2E}
.t-gray{background:#EEF0F3;color:#4A5563}.t-gray i{background:#8A94A3}
.t-red{background:#FDE4E2;color:#9B1C1C}.t-red i{background:#C53030}
.t-orange{background:#FDEBDD;color:#9C4221}.t-orange i{background:#DD6B20}
.t-purple{background:#EEE7FB;color:#553C9A}.t-purple i{background:#6B46C1}
.t-teal{background:#E0F2F1;color:#22605F}.t-teal i{background:#2C7A7B}
.sg-contact{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.sg-av{width:24px;height:24px;border-radius:50%;color:#fff;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto}
.sg-cname{overflow:hidden;text-overflow:ellipsis}
.sg-panel{width:380px;flex:0 0 380px;align-self:stretch;background:#fff;border-left:1px solid ${GRID};position:sticky;top:0;max-height:100vh;display:flex;flex-direction:column}
.sg-phead{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid ${GRID};font-size:14px}
.sg-x{border:none;background:none;font-size:22px;line-height:1;cursor:pointer;color:${SUBTLE}}
.sg-pbody{padding:10px 14px 18px;overflow-y:auto;font-size:13.5px}
.sg-pbody .k,.sg-sheetsum .k{font-size:10.5px;font-weight:800;letter-spacing:.8px;color:#8A94A3;text-transform:uppercase}
.sg-pmeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sg-pbig{border:none;padding:0;background:none;cursor:zoom-in;display:block;width:100%;margin:8px 0}
.sg-pbig img{width:100%;max-height:260px;object-fit:cover;border-radius:8px;border:1px solid ${GRID}}
.sg-photos{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.sg-pcard{border:1px solid ${GRID};border-radius:8px;padding:0;background:#fff;cursor:pointer;text-align:left;font:inherit;font-size:12px;overflow:hidden}
.sg-pcard img{width:100%;height:96px;object-fit:cover;display:block}
.sg-pcard span{display:block;padding:5px 7px;color:${SUBTLE}}
.sg-sheetsum{background:#fff;border:1px solid ${GRID};border-radius:6px;padding:12px 14px;margin-top:12px;font-size:13.5px}
.sg-sheetsum h3{margin:0 0 6px;font-size:14px;color:${NAVY}}
.sg-sheetsum p{margin:4px 0}
.sg-board{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}
.sg-lane{flex:0 0 280px;background:#E9ECF1;border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 200px);overflow-y:auto}
.sg-lanehead{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 2px 6px}
.sg-card{border:1px solid ${GRID};background:#fff;border-radius:8px;padding:8px 10px;display:flex;flex-direction:column;gap:4px;text-align:left;font:inherit;font-size:13px;cursor:pointer}
.sg-card img{width:100%;height:120px;object-fit:cover;border-radius:6px}
.sg-card.stop{background:#FEF3F2;border-color:#FDA29B;cursor:default}
.sg-mtop{display:flex;align-items:center;gap:8px}
.sg-mlist{display:none}
.sg-foot{text-align:center;font-size:11px;color:#9AA0AA;padding:14px 12px}
/* message bubbles and the composer (components/SheetMessages.tsx) */
.ps-input{font:inherit;font-size:16px;padding:6px 8px;border:1px solid #CBD2D9;border-radius:6px;background:#fff;min-width:0}
.ps-select{font:inherit;font-size:16px;padding:5px 8px;border:1px solid #CBD2D9;border-radius:6px;background:#fff}
.ps-btn{border:1px solid ${NAVY};background:#fff;color:${NAVY};border-radius:6px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-block}
.ps-btn-dark{background:${NAVY};color:#fff}
.ps-btn:disabled{opacity:.5;cursor:default}
.ps-link{border:none;background:none;color:#1D4ED8;cursor:pointer;font:inherit;font-size:12px;padding:2px 0;display:block;text-align:left}
.ps-compose{background:#F8F9FB;border:1px solid ${GRID};border-radius:8px;padding:8px;margin-top:8px}
.ps-bubble{border-radius:8px;padding:8px 10px;font-size:13px;border:1px solid ${GRID};background:#fff;margin-top:6px}
.ps-bubble.tech{background:#EEF4FF;border-color:#C7D7FE}
.ps-bubble.client{background:#FFFBEB;border-color:#FDE68A}
.ps-bubble.waiting{background:#FEF3F2;border-color:#FDA29B}
.ps-lightbox{position:fixed;inset:0;background:rgba(14,27,46,.8);display:flex;align-items:center;justify-content:center;padding:16px;z-index:70}
.ps-lightbox-in{background:#fff;border-radius:12px;padding:12px;max-width:min(900px,100%);max-height:100%;overflow:auto}
.ps-lightbox-in img{max-width:100%;max-height:70vh;display:block;margin:0 auto;border-radius:8px}
@media (max-width:760px){
  .sg-appbar{padding:10px 12px}
  .sg-title{order:3;flex-basis:100%;font-size:16px}
  .sg-toolbar{padding:8px}
  .sg-sheetpick{flex-basis:100%}
  .sg-spacer{display:none}
  .sg-left{padding:8px}
  .sg-scroll{display:none}
  .sg-mlist{display:block}
  .sg-mday{display:flex;justify-content:space-between;width:100%;border:none;background:#E3E7EE;color:${NAVY};font:inherit;font-weight:700;padding:9px 12px;border-radius:6px;margin-top:8px;cursor:pointer}
  .sg-mrow{display:flex;flex-direction:column;gap:3px;width:100%;text-align:left;font:inherit;font-size:13.5px;background:#fff;border:1px solid ${GRID};border-radius:8px;padding:9px 11px;margin-top:6px;cursor:pointer}
  .sg-mrow.fresh{animation:sgflash 8s ease-out}
  .sg-mact{font-size:14px}
  .sg-mmeta{color:${SUBTLE};font-size:12.5px}
  .sg-mthumb{width:100%;max-height:180px;object-fit:cover;border-radius:6px;margin-top:4px}
  .sg-main.with-panel .sg-panel{position:fixed;inset:0;width:auto;max-height:none;z-index:65;border:none}
  .sg-lane{flex-basis:84vw}
}
@media print{
  .ps-noprint,.ps-lightbox{display:none!important}
}
`;
