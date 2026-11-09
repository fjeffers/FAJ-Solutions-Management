// The client copy of one LDS daily checkout: every answer, every AP run, and
// the labeled photos, as one PDF for the SimplySub job's Files tab.
import { wrapLine } from './doc-to-pdf';
import type { LdsDailyCheckout, LdsEvidence } from './lds-daily-checkout';
import { progressAlert } from './lds-daily-checkout';

const yes = (v: string) => (v === 'yes' ? 'Yes' : v === 'no' ? 'No' : '—');
const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, ' ');

export function checkoutLines(c: LdsDailyCheckout, head: { woNumber: string; site: string; tech: string }): string[][] {
  const day = c.installDay === 'return' ? 'Return visit' : `Day ${c.installDay}`;
  const out: string[][] = [[`${day} checkout · WO ${head.woNumber}`], [`${head.site} · ${head.tech} · ${c.day}`],
    [`Schedule: ${progressAlert(c) ?? 'On schedule. Materials in hand.'}`]];
  if (c.installDay === 1) {
    out.push(['Day 1 walkthrough'], [`Floor plan matches: ${yes(c.day1.floorPlanMatches)}`], [`MDF: ${c.day1.mdfLocation || '—'}`],
      [`Fire panel: ${yes(c.day1.firePanelPresent)} · Church camera: ${yes(c.day1.churchCameraPresent)} · Family History room: ${yes(c.day1.familyHistoryPresent)} · Existing rack: ${yes(c.day1.existingRack)}`]);
  }
  out.push(['Materials'], [`Arrived: ${yes(c.materials.arrived)} · Short tomorrow: ${yes(c.materials.shortageTomorrow)}`],
    [`Received: ${c.materials.received || '—'}`], [`Missing: ${c.materials.missing || 'Nothing'}`], ['AP cable runs']);
  for (const ap of c.aps) {
    const parts = [`Pulled ${yes(ap.cablePulled)}`];
    if (ap.cablePulled === 'no') parts.push(`why: ${ap.pullReason}`);
    if (ap.cablePulled === 'yes') parts.push(`${ap.footage ?? '?'} ft`, `Terminated ${yes(ap.terminated)}`);
    if (ap.terminated === 'no') parts.push(`why: ${ap.terminationReason}`);
    if (ap.terminated === 'yes') parts.push(`Labeled end to end ${yes(ap.labeledEndToEnd)}`);
    if (ap.labeledEndToEnd === 'no') parts.push(`why: ${ap.labelingReason}`);
    if (ap.labeledEndToEnd === 'yes') parts.push(`Tested ${yes(ap.tested)}${ap.testResult ? ` (${ap.testResult})` : ''}`);
    if (ap.testNotes) parts.push(ap.testNotes);
    out.push([`${ap.name}: ${parts.join(' · ')}`]);
  }
  if (c.installDay === 5 || c.installDay === 'return') {
    const f = c.final;
    out.push(['Decom and closeout'], [`Decom complete ${yes(f.decomComplete)} · Old APs removed ${yes(f.oldApsRemoved)} · Old cable removed ${yes(f.oldCableRemoved)} · Old switches removed ${yes(f.oldSwitchesRemoved)}`],
      [`System up ${yes(f.systemUp)} · Wi-Fi verified ${yes(f.wifiVerified)} · Heatmap ${yes(f.heatmapComplete)} · Fluke files ${yes(f.flukeFilesComplete)}`], [`Punch list: ${f.punchList || 'None'}`]);
  }
  out.push(['Today'], [`Done: ${c.workCompleted || '—'}`], [`Tomorrow: ${c.planTomorrow || '—'}`]);
  return out;
}

export const checkoutEvidence = (c: LdsDailyCheckout): LdsEvidence[] => [
  ...c.day1.evidence, ...c.materials.evidence, ...c.aps.flatMap((a) => a.evidence), ...c.final.evidence, ...c.generalEvidence,
];

export async function checkoutPdf(c: LdsDailyCheckout, head: { woNumber: string; site: string; tech: string },
  fetchImage: (url: string) => Promise<Uint8Array | null>): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  doc.setTitle(`LDS checkout WO ${head.woNumber} ${c.day}`); doc.setProducer('FAJ Solutions');
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const [W, H, M] = [612, 792, 40];
  let page = doc.addPage([W, H]); let y = H - M;
  const headings = new Set(['Day 1 walkthrough', 'Materials', 'AP cable runs', 'Decom and closeout', 'Today']);
  const lines = checkoutLines(c, head);
  lines.forEach(([t], i) => {
    const font = i === 0 || headings.has(t) ? bold : regular;
    const size = i === 0 ? 15 : headings.has(t) ? 12 : 10;
    for (const ln of wrapLine(clean(t), W - 2 * M, (s) => font.widthOfTextAtSize(s, size))) {
      if (y < M + 20) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(ln, { x: M, y: y - size, size, font, color: rgb(0.06, 0.1, 0.18) });
      y -= size + 5;
    }
    if (headings.has(t)) y -= 2;
  });
  const photos = checkoutEvidence(c);
  if (photos.length) {
    page = doc.addPage([W, H]); y = H - M;
    page.drawText('Labeled photos', { x: M, y: y - 14, size: 14, font: bold }); y -= 28;
    const boxW = (W - 2 * M - 12) / 2, boxH = 200;
    for (let i = 0; i < photos.length; i += 1) {
      const col = i % 2;
      if (col === 0 && y - boxH - 24 < M) { page = doc.addPage([W, H]); y = H - M; }
      const x = M + col * (boxW + 12);
      const bytes = await fetchImage(photos[i].url);
      if (bytes) {
        try {
          const img = await doc.embedJpg(bytes).catch(() => doc.embedPng(bytes));
          const sc = Math.min(boxW / img.width, boxH / img.height);
          page.drawImage(img, { x, y: y - img.height * sc, width: img.width * sc, height: img.height * sc });
        } catch { /* caption still printed */ }
      }
      page.drawText(clean(photos[i].label).slice(0, 60), { x, y: y - boxH - 14, size: 9, font: regular });
      if (col === 1 || i === photos.length - 1) y -= boxH + 28;
    }
  }
  return doc.save();
}
