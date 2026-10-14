'use client';

// The printed project report (Fred, 2026-10-14: "a readable friendly
// smartsheet where they can follow along, that can print a completed,
// comprehensive report"). Hidden on screen; Print shows it instead of the
// live page. One site or the whole project: the site's details and totals,
// every line in time order with the messages, the photos large with what
// each one is, the notes, answers, checklist, the waits without access, and
// the receipts. Same lines as the live sheet (lib/project-sheet.ts).
import { fmtSheetDay, messageTitle, money2, pageRows, waitMinutes, type Sheet, type SheetMessage, type SheetSite } from '@/lib/project-sheet';

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export default function ProjectSheetReport({ sheet, messages, sites, printedAt }: {
  sheet: Sheet; messages: SheetMessage[]; sites: SheetSite[]; printedAt: Date;
}) {
  return (
    <div className="pr-report">
      <div className="pr-cover">
        <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 3, color: '#0E1B2E' }}>FAJ SOLUTIONS</div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#8a6d2f' }}>PROJECT REPORT</div>
        <h1 style={{ margin: '14px 0 2px', fontSize: 24, color: '#0E1B2E' }}>{sheet.project}</h1>
        <div style={{ color: '#5E6470', fontSize: 12 }}>
          {sites.length === 1 ? `${sites[0].name} · WO ${sites[0].wo}` : `${sites.length} sites`} · printed {printedAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })}
        </div>
      </div>

      {sites.map((site) => <SiteReport key={site.id} sheet={sheet} site={site} messages={messages.filter((m) => m.wo === site.wo)} now={printedAt} />)}

      <div className="pr-foot">FAJ Solutions · Bringing People and Technology Together. Times, places and miles come from the technician&apos;s phone.</div>
    </div>
  );
}

function SiteReport({ sheet, site, messages, now }: { sheet: Sheet; site: SheetSite; messages: SheetMessage[]; now: Date }) {
  const rows = pageRows(sheet, site.id, null);
  const photos = rows.filter((r) => r.kind === 'photo' && r.photo);
  const receipts = rows.filter((r) => r.kind === 'receipt');
  const issues = messages.filter((m) => m.kind === 'issue');
  const waited = issues.reduce((s, m) => s + waitMinutes(m, now), 0);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  // The timeline: every line, and the messages that aren't under a line.
  type Item = { at: string; day: string; when: string; who: string; what: string; where: string; extra: string };
  const items: Item[] = [
    ...rows.map((r) => ({
      at: r.at, day: r.day, when: r.time, who: r.tech, what: r.activity, where: r.where,
      extra: [r.details, r.miles != null ? `${r.miles} mi` : '', r.amount != null ? money2(r.amount) : ''].filter(Boolean).join(' · '),
    })),
    ...messages.map((m) => ({
      at: m.at, day: dayOf(m.at), when: time(m.at), who: m.from, what: messageTitle(m, messages), where: '',
      extra: m.kind === 'issue' ? [m.reason, `${waitMinutes(m, now)} min without access${m.resolvedAt ? '' : ' (still waiting)'}`].filter(Boolean).join(' · ')
        : m.kind === 'resolved' ? '' : m.body,
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <section className="pr-site">
      <h2 className="pr-h2">{site.name}</h2>
      <table className="pr-kv">
        <tbody>
          {[
            ['Address', site.address],
            ['Work order', site.wo],
            ['Client work order', site.clientWo],
            ['Status', site.closed ? `Site closed (${site.status})` : site.status || 'Open'],
            ['Dates', days.length ? `${fmtSheetDay(days[0])}${days.length > 1 ? ` – ${fmtSheetDay(days[days.length - 1])}` : ''}` : '—'],
            ['Technicians', site.techs.join(', ') || '—'],
          ].filter(([, v]) => v).map(([k, v]) => <tr key={k}><th>{k}</th><td>{v}</td></tr>)}
        </tbody>
      </table>

      <div className="pr-tiles">
        {[
          ['Hours on site', String(site.onSiteHours)],
          ['Miles', String(site.miles)],
          ['Photos', String(photos.length)],
          ['Receipts', money2(site.receiptTotal)],
          ['Without access', waited ? `${waited} min` : 'None'],
        ].map(([k, v]) => <div key={k} className="pr-tile"><div className="k">{k}</div><div className="v">{v}</div></div>)}
      </div>

      <h3 className="pr-h3">Timeline</h3>
      <table className="pr-grid">
        <thead><tr><th>Time</th><th>Who</th><th>What</th><th>Where</th><th>Details</th></tr></thead>
        <tbody>
          {items.length === 0 && <tr><td colSpan={5}>Nothing recorded on this site.</td></tr>}
          {items.map((it, n) => [
            n === 0 || items[n - 1].day !== it.day ? <tr key={`d${it.day}`} className="pr-day"><td colSpan={5}>{fmtSheetDay(it.day)}</td></tr> : null,
            <tr key={`${it.at}${n}`}><td style={{ whiteSpace: 'nowrap' }}>{it.when}</td><td>{it.who}</td><td><b>{it.what}</b></td><td>{it.where}</td><td>{it.extra}</td></tr>,
          ])}
        </tbody>
      </table>

      {(site.notes || site.answers.length > 0 || site.checklist.total > 0) && (
        <>
          <h3 className="pr-h3">Site report</h3>
          {site.checklist.total > 0 && (
            <p><b>{site.checklist.name}:</b> {site.checklist.done} of {site.checklist.total} done · {site.checklist.sign}</p>
          )}
          {site.checklist.cant.map(([item, why]) => <p key={item}>Could not do <b>{item}</b>: {why}</p>)}
          {site.notes && <><p style={{ fontWeight: 700, marginBottom: 2 }}>Notes</p><p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{site.notes}</p></>}
          {site.answers.map((a) => <p key={a.q}><b>{a.q}:</b> {a.a}</p>)}
        </>
      )}

      {receipts.length > 0 && (
        <>
          <h3 className="pr-h3">Receipts · {money2(site.receiptTotal)}</h3>
          <table className="pr-grid">
            <thead><tr><th>Date</th><th>Who</th><th>What</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}><td>{fmtSheetDay(r.day)}</td><td>{r.tech}</td><td>{[r.activity.replace('Added a receipt: ', ''), r.details].filter(Boolean).join(' · ')}</td>
                  <td style={{ textAlign: 'right' }}>{r.amount != null ? money2(r.amount) : ''}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {photos.length > 0 && (
        <>
          <h3 className="pr-h3">Photos</h3>
          <div className="pr-photos">
            {photos.map((r) => (
              <figure key={r.id} className="pr-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.photo!} alt={r.activity} loading="eager" />
                <figcaption><b>{r.activity.replace('Took a photo: ', '').replace('Took a photo', 'Photo')}</b><br />{r.tech} · {fmtSheetDay(r.day)} {r.time}</figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export const REPORT_CSS = `
.pr-report{display:none}
@media print{
  .pr-report{display:block;font-family:Arial,Helvetica,sans-serif;color:#1B1C1F;font-size:11.5px}
  .ps-screen{display:none!important}
  .pr-cover{border-bottom:3px solid #C9A24B;padding-bottom:10px;margin-bottom:14px}
  .pr-site{break-before:page}
  .pr-site:first-of-type{break-before:auto}
  .pr-h2{font-size:18px;color:#0E1B2E;margin:0 0 6px}
  .pr-h3{font-size:13px;color:#0E1B2E;border-bottom:2px solid #C9A24B;padding-bottom:3px;margin:16px 0 6px;break-after:avoid}
  .pr-kv{border-collapse:collapse;margin-bottom:8px}
  .pr-kv th{text-align:left;color:#5E6470;font-weight:600;padding:2px 14px 2px 0;vertical-align:top}
  .pr-kv td{padding:2px 0}
  .pr-tiles{display:flex;gap:8px;margin:8px 0}
  .pr-tile{border:1px solid #E4DFD3;border-radius:8px;padding:6px 10px;flex:1}
  .pr-tile .k{font-size:9px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:#888}
  .pr-tile .v{font-size:15px;font-weight:800;color:#0E1B2E}
  .pr-grid{width:100%;border-collapse:collapse}
  .pr-grid th{background:#0E1B2E;color:#fff;text-align:left;font-size:9.5px;letter-spacing:.5px;text-transform:uppercase;padding:5px 6px}
  .pr-grid td{border-bottom:1px solid #ECE8DF;padding:4px 6px;vertical-align:top}
  .pr-grid tr{break-inside:avoid}
  .pr-day td{background:#F6F1E4;font-weight:800;color:#0E1B2E}
  .pr-photos{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .pr-photo{margin:0;break-inside:avoid;border:1px solid #E4DFD3;border-radius:6px;overflow:hidden}
  .pr-photo img{width:100%;height:150px;object-fit:cover;display:block}
  .pr-photo figcaption{padding:4px 6px;font-size:10px;color:#5E6470}
  .pr-foot{margin-top:18px;font-size:9.5px;color:#9AA0AA;text-align:center}
  @page{margin:12mm}
}
`;
