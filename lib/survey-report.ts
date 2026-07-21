// Client-deliverable site survey report. Opens a print-ready window with the
// floor plan, equipment list, drop/label table, cable-run totals, and photo
// appendix — the browser's Print → Save as PDF produces the handoff document.
import type { FloorPlan, NetworkDrop, PlanItemType } from './types';
import { ITEM_META, polylineLength, unitsToFeet, withServiceLoop, cat6Boxes } from './floorplan';

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const STATUS_LABEL: Record<string, string> = {
  active: 'In Use', needs_label: 'Needs Label', office_closed: 'Office Closed',
};

export function buildSurveyReportHTML(opts: {
  projectName: string;
  floorName: string;
  plan: FloorPlan;
  drops: NetworkDrop[];
  planSvg: string;
}): string {
  const { projectName, floorName, plan, drops, planSvg } = opts;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Equipment grouped by type + variety
  const equip = new Map<string, { type: PlanItemType; variant: string; count: number }>();
  for (const it of plan.items) {
    const key = `${it.type}|${it.variant ?? ''}`;
    const cur = equip.get(key) ?? { type: it.type, variant: it.variant ?? '', count: 0 };
    cur.count++;
    equip.set(key, cur);
  }
  const equipRows = [...equip.values()]
    .sort((a, b) => a.type.localeCompare(b.type) || a.variant.localeCompare(b.variant))
    .map((e) => `<tr><td>${esc(ITEM_META[e.type].label)}</td><td>${esc(e.variant) || '—'}</td><td class="num">${e.count}</td></tr>`)
    .join('');

  // Cable runs
  const runs = plan.runs ?? [];
  const upf = plan.scale?.unitsPerFt ?? null;
  let runsSection = '';
  if (runs.length > 0) {
    let totalFt = 0;
    const runRows = runs.map((r, i) => {
      const ft = unitsToFeet(polylineLength(r.points), upf);
      if (ft != null) totalFt += ft;
      return `<tr><td>Run ${i + 1}${r.note ? ` — ${esc(r.note)}` : ''}</td><td class="num">${ft != null ? `${Math.round(ft)} ft` : `${Math.round(polylineLength(r.points))} units`}</td><td class="num">${ft != null ? `${Math.round(withServiceLoop(ft))} ft` : '—'}</td></tr>`;
    }).join('');
    const totals = upf
      ? `<tr class="total"><td>Total (${runs.length} runs)</td><td class="num">${Math.round(totalFt)} ft</td><td class="num">${Math.round(withServiceLoop(totalFt))} ft ≈ ${cat6Boxes(totalFt)} box${cat6Boxes(totalFt) !== 1 ? 'es' : ''} of Cat6</td></tr>`
      : '';
    runsSection = `
      <h2>Cable Runs</h2>
      ${upf ? '' : '<p class="muted">Plan is not calibrated — lengths shown in plan units. Use Set Scale on the floor plan for footage.</p>'}
      <table><thead><tr><th>Run</th><th class="num">Measured</th><th class="num">With 15% service loop</th></tr></thead>
      <tbody>${runRows}${totals}</tbody></table>`;
  }

  // Drops table
  const dropRows = drops
    .slice()
    .sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true }))
    .map((d) => `<tr>
      <td><b>${esc(d.room)}</b>${d.assigned_to ? `<br><span class="muted">${esc(d.assigned_to)}</span>` : ''}</td>
      <td>${esc(d.wall_jack_label) || '—'}</td>
      <td class="new">${esc(d.target_label) || '—'}</td>
      <td>${d.switch_port != null ? `Port ${d.switch_port}` : '—'}</td>
      <td>${STATUS_LABEL[d.status] ?? esc(d.status)}</td>
    </tr>`).join('');

  // Photo appendix
  const photoItems = plan.items.filter((it) => it.photos.length > 0);
  const photosSection = photoItems.length === 0 ? '' : `
    <h2>Site Photos</h2>
    ${photoItems.map((it) => `
      <div class="photo-group">
        <div class="photo-cap">${esc(ITEM_META[it.type].label)}${it.variant ? ` — ${esc(it.variant)}` : ''}${it.label ? ` · ${esc(it.label)}` : ''}</div>
        <div class="photo-row">${it.photos.map((u) => `<img src="${esc(u)}" alt="">`).join('')}</div>
      </div>`).join('')}`;

  const stats = [
    `${plan.rooms.length} room${plan.rooms.length !== 1 ? 's' : ''}`,
    `${plan.items.length} placed item${plan.items.length !== 1 ? 's' : ''}`,
    `${drops.length} network drop${drops.length !== 1 ? 's' : ''} on record`,
    runs.length > 0 ? `${runs.length} measured cable run${runs.length !== 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Site Survey — ${esc(projectName)} ${esc(floorName)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; margin: 32px; font-size: 12px; }
    header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 3px solid #0D7377; padding-bottom: 10px; margin-bottom: 6px; }
    .brand { font-size: 20px; font-weight: 800; color: #0D7377; letter-spacing: 1px; }
    h1 { font-size: 17px; margin: 10px 0 2px; }
    h2 { font-size: 13px; color: #0D7377; text-transform: uppercase; letter-spacing: 1px; margin: 22px 0 8px; page-break-after: avoid; }
    .muted { color: #777; }
    .plan { border: 1px solid #ddd; border-radius: 8px; padding: 6px; margin-top: 10px; }
    .plan svg { width: 100%; height: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #0D7377; color: white; text-align: left; padding: 5px 8px; }
    td { border-bottom: 1px solid #eee; padding: 5px 8px; vertical-align: top; }
    .num { text-align: right; }
    .new { color: #0D7377; font-weight: 700; }
    tr.total td { font-weight: 800; border-top: 2px solid #0D7377; }
    .photo-group { margin-bottom: 12px; page-break-inside: avoid; }
    .photo-cap { font-weight: 700; margin-bottom: 4px; }
    .photo-row img { height: 130px; border-radius: 6px; margin: 0 6px 6px 0; border: 1px solid #ddd; }
    footer { margin-top: 26px; padding-top: 8px; border-top: 1px solid #ddd; color: #999; font-size: 10px; }
    @media print { body { margin: 12mm; } }
  </style></head><body>
  <header><span class="brand">FAJ SOLUTIONS</span><span class="muted">Network Site Survey · ${esc(date)}</span></header>
  <h1>${esc(projectName)} — ${esc(floorName)}</h1>
  <div class="muted">${stats}</div>
  <div class="plan">${planSvg}</div>
  <h2>Equipment</h2>
  <table><thead><tr><th>Type</th><th>Variety / Model</th><th class="num">Qty</th></tr></thead><tbody>${equipRows || '<tr><td colspan="3" class="muted">No items placed yet.</td></tr>'}</tbody></table>
  ${runsSection}
  <h2>Network Drops &amp; Labeling</h2>
  <table><thead><tr><th>Room</th><th>Current Label</th><th>New Label</th><th>Switch Port</th><th>Status</th></tr></thead><tbody>${dropRows || '<tr><td colspan="5" class="muted">No drops recorded.</td></tr>'}</tbody></table>
  ${photosSection}
  <footer>Prepared with FAJ Business Manager · fajsolutions.com</footer>
  <script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 400); });</script>
  </body></html>`;
}

export function openSurveyReport(html: string): boolean {
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
