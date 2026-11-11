import { describe, expect, it } from 'vitest';
import {
  apRuns, blankAp, effectiveProgress, ldsInstallDay, ldsSections, progressAlert, visibleApFields,
  type LdsDailyCheckout,
} from './lds-daily-checkout';

describe('LDS daily checkout', () => {
  it('knows Day 1 through Day 5 from the job dates, then a return visit', () => {
    expect(ldsInstallDay('2026-11-09', '2026-11-13', '2026-11-09')).toBe(1);
    expect(ldsInstallDay('2026-11-09', '2026-11-13', '2026-11-11')).toBe(3);
    expect(ldsInstallDay('2026-11-09', '2026-11-13', '2026-11-13')).toBe(5);
    expect(ldsInstallDay('2026-11-09', '2026-11-13', '2026-11-16')).toBe('return');
    expect(ldsSections(1)).toContain('walkthrough');
    expect(ldsSections(3)).not.toContain('walkthrough');
    expect(ldsSections(5)).toEqual(expect.arrayContaining(['decom', 'system_verification', 'final_closeout']));
  });

  it('generates AP-01 through AP-10 and keeps answers already entered', () => {
    const first = blankAp(0);
    first.cablePulled = 'yes';
    expect(apRuns(3, [first]).map((a) => a.name)).toEqual(['AP-01', 'AP-02', 'AP-03']);
    expect(apRuns(3, [first])[0].cablePulled).toBe('yes');
    expect(apRuns(99)).toHaveLength(10);
  });

  it('only asks the follow-up questions that apply', () => {
    const ap = blankAp(0);
    expect(visibleApFields(ap)).toEqual(['cablePulled']);
    ap.cablePulled = 'no';
    expect(visibleApFields(ap)).toEqual(['cablePulled', 'pullReason']);
    ap.cablePulled = 'yes';
    expect(visibleApFields(ap)).toEqual(['cablePulled', 'footage', 'pullPhoto', 'terminated']);
    ap.terminated = 'no';
    expect(visibleApFields(ap).at(-1)).toBe('terminationReason');
    ap.terminated = 'yes';
    ap.labeledEndToEnd = 'yes';
    ap.tested = 'yes';
    expect(visibleApFields(ap)).toEqual(expect.arrayContaining(['testResult', 'testNotes', 'finishedPhoto']));
  });

  it('turns missing materials and blockers into an office alert', () => {
    const checkout = {
      progress: 'on_track', blocker: 'no', blockerType: [], blockerNote: '',
      materials: { missing: '2 AP mounts', shortageTomorrow: 'yes' },
    } as unknown as LdsDailyCheckout;
    expect(effectiveProgress(checkout)).toBe('at_risk');
    expect(progressAlert(checkout)).toContain('Missing materials: 2 AP mounts');
    checkout.progress = 'behind';
    checkout.blocker = 'yes';
    checkout.blockerType = ['Access/keys'];
    expect(progressAlert(checkout)).toContain('Behind schedule: Access/keys');
  });
});
