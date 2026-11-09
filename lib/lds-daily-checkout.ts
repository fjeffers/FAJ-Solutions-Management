// LDS daily checkout in FAJ. The client Smartsheet has Day 1–5, but its middle
// days are one flat checklist and it has no photo fields. FAJ keeps the day
// automatic, asks only the follow-ups that apply, labels evidence, and builds
// one report for the client.

export type LdsInstallDay = 1 | 2 | 3 | 4 | 5 | 'return';
export type YesNo = '' | 'yes' | 'no';
export type LdsProgress = 'on_track' | 'at_risk' | 'behind';
export type LdsCheckoutSection =
  | 'walkthrough' | 'materials' | 'runs' | 'daily'
  | 'decom' | 'system_verification' | 'final_closeout';

export type LdsEvidence = {
  id: string;
  label: string;
  url: string;
  takenAt?: string;
};

export type LdsApRun = {
  id: string;
  name: string;
  cablePulled: YesNo;
  pullReason: string;
  footage: number | null;
  terminated: YesNo;
  terminationReason: string;
  labeledEndToEnd: YesNo;
  labelingReason: string;
  tested: YesNo;
  testResult: '' | 'pass' | 'fail';
  testNotes: string;
  evidence: LdsEvidence[];
};

export type LdsDay1 = {
  floorPlanMatches: YesNo;
  mdfLocation: string;
  firePanelPresent: YesNo;
  churchCameraPresent: YesNo;
  familyHistoryPresent: YesNo;
  existingRack: YesNo;
  existingSwitchCount: number | null;
  evidence: LdsEvidence[];
};

export type LdsMaterials = {
  arrived: YesNo;
  packingListPhoto: string;
  received: string;
  missing: string;
  shortageTomorrow: YesNo;
  evidence: LdsEvidence[];
};

export type LdsFinal = {
  decomComplete: YesNo;
  oldApsRemoved: YesNo;
  oldCableRemoved: YesNo;
  oldSwitchesRemoved: YesNo;
  systemUp: YesNo;
  wifiVerified: YesNo;
  heatmapComplete: YesNo;
  flukeFilesComplete: YesNo;
  punchList: string;
  evidence: LdsEvidence[];
};

export type LdsDailyCheckout = {
  installDay: LdsInstallDay;
  day: string;
  progress: LdsProgress;
  progressNote: string;
  blocker: YesNo;
  blockerType: string[];
  blockerNote: string;
  plannedApCount: number;
  aps: LdsApRun[];
  day1: LdsDay1;
  materials: LdsMaterials;
  final: LdsFinal;
  workCompleted: string;
  planTomorrow: string;
  generalEvidence: LdsEvidence[];
};

export type LdsDailyCheckoutRow = {
  id: string;
  user_id: string;
  wo_id: string;
  wo_number: string;
  contractor_id: string;
  contractor_name: string;
  day: string;
  install_day: string;
  progress: LdsProgress;
  data: LdsDailyCheckout;
  submitted_at: string | null;
  report_url: string | null;
  report_generated_at: string | null;
  simplysub_file_key: string | null;
  simplysub_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
};

const dateOnly = (value: string | null | undefined) => {
  const d = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '';
};

const utcDay = (day: string) => Date.parse(`${day}T12:00:00Z`);

/** Day is taken from the job's scheduled start, never typed by the tech. */
export function ldsInstallDay(start: string | null | undefined, end: string | null | undefined, today: string): LdsInstallDay {
  const first = dateOnly(start);
  const current = dateOnly(today);
  if (!first || !current) return 1;
  const last = dateOnly(end);
  if (last && current > last) return 'return';
  const n = Math.floor((utcDay(current) - utcDay(first)) / 86_400_000) + 1;
  if (n <= 1) return 1;
  if (n >= 5) return 5;
  return n as 2 | 3 | 4;
}

export function ldsSections(day: LdsInstallDay): LdsCheckoutSection[] {
  if (day === 1) return ['walkthrough', 'materials', 'runs', 'daily'];
  if (day === 5) return ['materials', 'runs', 'decom', 'system_verification', 'final_closeout', 'daily'];
  if (day === 'return') return ['materials', 'runs', 'system_verification', 'final_closeout', 'daily'];
  return ['materials', 'runs', 'daily'];
}

export const ldsApName = (index: number) => `AP-${String(index + 1).padStart(2, '0')}`;

export function blankAp(index: number): LdsApRun {
  const name = ldsApName(index);
  return {
    id: name.toLowerCase(), name, cablePulled: '', pullReason: '', footage: null,
    terminated: '', terminationReason: '', labeledEndToEnd: '', labelingReason: '',
    tested: '', testResult: '', testNotes: '', evidence: [],
  };
}

/** Keep entered APs when the planned count changes; generate names through AP-10. */
export function apRuns(count: number, current: LdsApRun[] = []): LdsApRun[] {
  const size = Math.max(1, Math.min(10, Math.round(Number(count) || 1)));
  return Array.from({ length: size }, (_, index) => current[index] ?? blankAp(index));
}

export type ApField =
  | 'cablePulled' | 'pullReason' | 'footage' | 'pullPhoto'
  | 'terminated' | 'terminationReason' | 'labeledEndToEnd' | 'labelingReason'
  | 'tested' | 'testResult' | 'testNotes' | 'finishedPhoto';

/** The next question does not appear until the prior work happened. */
export function visibleApFields(ap: LdsApRun): ApField[] {
  const fields: ApField[] = ['cablePulled'];
  if (ap.cablePulled === 'no') return [...fields, 'pullReason'];
  if (ap.cablePulled !== 'yes') return fields;
  fields.push('footage', 'pullPhoto', 'terminated');
  if (ap.terminated === 'no') return [...fields, 'terminationReason'];
  if (ap.terminated !== 'yes') return fields;
  fields.push('labeledEndToEnd');
  if (ap.labeledEndToEnd === 'no') return [...fields, 'labelingReason'];
  if (ap.labeledEndToEnd !== 'yes') return fields;
  fields.push('tested');
  if (ap.tested === 'no') return [...fields, 'testNotes', 'finishedPhoto'];
  if (ap.tested === 'yes') fields.push('testResult', 'testNotes', 'finishedPhoto');
  return fields;
}

export const DAY_ONE_EVIDENCE = [
  'Floor plan / walkthrough', 'MDF location', 'Fire panel', 'Church camera',
  'Family History room', 'Existing rack', 'Existing switches', 'Pre-existing damage',
] as const;

export const MATERIAL_EVIDENCE = ['Packing list', 'Materials received', 'Missing or damaged materials'] as const;

export const FINAL_EVIDENCE = [
  'Decom before and after', 'Final rack', 'Final AP placement', 'Heatmap',
  'Fluke test results', 'System up and running', 'Punch list',
] as const;

/** A shortage or blocker raises the status even if "On track" was tapped. */
export function effectiveProgress(checkout: Pick<LdsDailyCheckout, 'progress' | 'blocker' | 'materials'>): LdsProgress {
  const missing = checkout.materials.missing.trim() || checkout.materials.shortageTomorrow === 'yes';
  if (checkout.progress === 'behind') return 'behind';
  if (checkout.blocker === 'yes' || missing) return 'at_risk';
  return checkout.progress;
}

export function progressAlert(checkout: Pick<LdsDailyCheckout, 'progress' | 'blocker' | 'blockerType' | 'blockerNote' | 'materials'>): string | null {
  const status = effectiveProgress(checkout);
  if (status === 'on_track') return null;
  const reasons = [
    ...checkout.blockerType,
    checkout.materials.missing.trim() ? `Missing materials: ${checkout.materials.missing.trim()}` : '',
    checkout.materials.shortageTomorrow === 'yes' ? 'Material shortage for tomorrow' : '',
    checkout.blockerNote.trim(),
  ].filter(Boolean);
  return `${status === 'behind' ? 'Behind schedule' : 'At risk'}${reasons.length ? `: ${reasons.join(' · ')}` : ''}`;
}
