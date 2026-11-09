import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { checkoutLines, checkoutPdf } from './lds-checkout-report';
import { apRuns, type LdsDailyCheckout } from './lds-daily-checkout';

const c = {
  installDay: 1, day: '2026-11-09', progress: 'on_track', progressNote: '', blocker: 'no', blockerType: [], blockerNote: '',
  plannedApCount: 2, aps: apRuns(2).map((a, i) => (i === 0 ? { ...a, cablePulled: 'yes', footage: 120, terminated: 'no', terminationReason: 'No jack yet' } : a)),
  day1: { floorPlanMatches: 'yes', mdfLocation: 'Room 38', firePanelPresent: 'yes', churchCameraPresent: 'no', familyHistoryPresent: 'yes', existingRack: 'yes', existingSwitchCount: 2, evidence: [] },
  materials: { arrived: 'yes', packingListPhoto: '', received: 'Cat6A, jacks', missing: '2 AP mounts', shortageTomorrow: 'no', evidence: [] },
  final: { decomComplete: '', oldApsRemoved: '', oldCableRemoved: '', oldSwitchesRemoved: '', systemUp: '', wifiVerified: '', heatmapComplete: '', flukeFilesComplete: '', punchList: '', evidence: [] },
  workCompleted: 'Walkthrough and AP-01 pull', planTomorrow: 'Terminate', generalEvidence: [],
} as LdsDailyCheckout;

describe('LDS checkout report', () => {
  it('lists the day, walkthrough, missing materials and each AP with its reason', () => {
    const text = checkoutLines(c, { woNumber: '19101452', site: '5006902', tech: 'Paul Gibbs' }).flat().join('\n');
    expect(text).toContain('Day 1 checkout · WO 19101452');
    expect(text).toContain('MDF: Room 38');
    expect(text).toContain('Missing materials: 2 AP mounts');
    expect(text).toContain('AP-01: Pulled Yes · 120 ft · Terminated No · why: No jack yet');
    expect(text).toContain('AP-02: Pulled —');
  });

  it('builds a PDF', async () => {
    const pdf = await PDFDocument.load(await checkoutPdf(c, { woNumber: '1', site: 's', tech: 't' }, async () => null));
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
});
