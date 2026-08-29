// The guided walk-through (migration-068/069 data, no schema change).
//
// A table of fields assumes you already know what to record. Standing in a
// building you do not — you want to be ASKED, one thing at a time, the way the
// job actually goes: "Camera 2, where is it going?" · "How does it mount?" ·
// "Roughly how much cable back to the closet?" · "1 of 7 done."
//
// This file is the question script. It is pure data plus a tiny state machine,
// so the flow is testable and the component only has to render it.
import type { CableDrop, SurveyCamera } from './types';
import {
  CAMERA_TYPES, CAMERA_MOUNTS, CAMERA_RESOLUTIONS, CABLE_RUN_PRESETS,
  CABLE_TYPES, DROP_MOUNTS,
} from './types';

export type GuideAnswerKind = 'chips' | 'chips-or-text' | 'text' | 'number' | 'money' | 'photo' | 'skip-only';

export type GuideStep = {
  /** Which field on the device row this answer lands in. */
  field: string;
  /** Asked out loud, with the device's number filled in. */
  prompt: (n: number) => string;
  kind: GuideAnswerKind;
  options?: readonly string[];
  placeholder?: string;
  hint?: string;
  /** Optional questions can be passed over without an answer. */
  optional?: boolean;
};

/** Locations that come up on nearly every camera job, offered as one tap. */
export const COMMON_CAMERA_LOCATIONS = [
  'Lobby', 'Front door / vestibule', 'Front entrance (exterior)', 'Network room (head-end)',
  'Office hallway', 'Rear entry', 'Parking lot', 'Loading dock', 'Stairwell', 'Reception',
] as const;

export const COMMON_DROP_LOCATIONS = [
  'Reception desk', 'Office', 'Conference room', 'Break room', 'Network closet',
  'Warehouse', 'Front counter', 'Back office',
] as const;

export const CAMERA_SCRIPT: GuideStep[] = [
  {
    field: 'location',
    prompt: (n) => `Camera ${n} — where is it going?`,
    kind: 'chips-or-text',
    options: COMMON_CAMERA_LOCATIONS,
    placeholder: 'e.g. Inside office hallway',
    hint: 'Tap a common spot or type your own.',
  },
  {
    field: 'camera_type',
    prompt: (n) => `What kind of camera at position ${n}?`,
    kind: 'chips',
    options: CAMERA_TYPES,
  },
  {
    field: 'mount',
    prompt: (n) => `How does camera ${n} mount?`,
    kind: 'chips',
    options: CAMERA_MOUNTS,
  },
  {
    field: 'placement',
    prompt: (n) => `Is camera ${n} indoor or outdoor?`,
    kind: 'chips',
    options: ['Indoor', 'Outdoor'],
  },
  {
    field: 'cable_run',
    prompt: (n) => `Roughly how much cable from camera ${n} back to the closet?`,
    kind: 'chips-or-text',
    options: CABLE_RUN_PRESETS,
    placeholder: 'e.g. 25 ft',
    hint: 'A guess is fine — TBD is a real answer.',
  },
  {
    field: 'resolution',
    prompt: (n) => `Resolution for camera ${n}?`,
    kind: 'chips',
    options: CAMERA_RESOLUTIONS,
    optional: true,
  },
  {
    field: 'origin_point',
    prompt: (n) => `Where does camera ${n}'s cable run from?`,
    kind: 'text',
    placeholder: 'e.g. Network room / IDF-2',
    optional: true,
  },
  {
    field: 'pathway_notes',
    prompt: (n) => `How does the cable get to camera ${n}?`,
    kind: 'chips-or-text',
    options: ['Drop ceiling / plenum', 'J-hooks', 'Existing conduit', 'New conduit', 'Surface raceway', 'Core drill'],
    placeholder: 'Describe the pathway',
    optional: true,
  },
  {
    field: 'unit_price',
    prompt: (n) => `What does camera ${n} sell for, installed?`,
    kind: 'money',
    placeholder: '0.00',
    hint: 'This is what the client pays for this position.',
  },
  {
    field: 'photos',
    prompt: (n) => `Take a photo of where camera ${n} goes.`,
    kind: 'photo',
    hint: 'This is what the client sees on the quote.',
    optional: true,
  },
  {
    field: 'notes',
    prompt: (n) => `Anything else about camera ${n}?`,
    kind: 'text',
    placeholder: 'Drop ceiling, sightline, obstruction…',
    optional: true,
  },
];

export const DROP_SCRIPT: GuideStep[] = [
  {
    field: 'location',
    prompt: (n) => `Drop ${n} — where is it going?`,
    kind: 'chips-or-text',
    options: COMMON_DROP_LOCATIONS,
    placeholder: 'e.g. Reception desk',
  },
  {
    field: 'jack_count',
    prompt: (n) => `How many jacks at drop ${n}?`,
    kind: 'number',
    hint: 'A dual drop is one location with two jacks.',
  },
  {
    field: 'cable_type',
    prompt: (n) => `What cable for drop ${n}?`,
    kind: 'chips',
    options: CABLE_TYPES,
  },
  {
    field: 'run_length',
    prompt: (n) => `Roughly how long is the run to drop ${n}?`,
    kind: 'chips-or-text',
    options: CABLE_RUN_PRESETS,
    placeholder: 'e.g. 85 ft',
  },
  {
    field: 'mount',
    prompt: (n) => `How does drop ${n} terminate at the wall?`,
    kind: 'chips',
    options: DROP_MOUNTS,
  },
  {
    field: 'termination',
    prompt: (n) => `Where does drop ${n} land at the head end?`,
    kind: 'text',
    placeholder: 'e.g. Patch panel A, ports 12-13',
    optional: true,
  },
  {
    field: 'origin_point',
    prompt: (n) => `Where does drop ${n} run from?`,
    kind: 'text',
    placeholder: 'e.g. Network closet',
    optional: true,
  },
  {
    field: 'pathway_notes',
    prompt: (n) => `How does the cable get to drop ${n}?`,
    kind: 'chips-or-text',
    options: ['Drop ceiling / plenum', 'J-hooks', 'Existing conduit', 'New conduit', 'Surface raceway', 'Core drill'],
    placeholder: 'Describe the pathway',
    optional: true,
  },
  {
    field: 'unit_price',
    prompt: (n) => `What does each jack at drop ${n} sell for?`,
    kind: 'money',
    placeholder: '0.00',
  },
  {
    field: 'photos',
    prompt: (n) => `Take a photo of where drop ${n} goes.`,
    kind: 'photo',
    optional: true,
  },
  {
    field: 'notes',
    prompt: (n) => `Anything else about drop ${n}?`,
    kind: 'text',
    placeholder: 'Pathway, obstructions, existing conduit…',
    optional: true,
  },
];

export function scriptFor(kind: 'cameras' | 'drops'): GuideStep[] {
  return kind === 'drops' ? DROP_SCRIPT : CAMERA_SCRIPT;
}

/** Has this device answered the step? Used for progress and for "skip". */
export function isAnswered(device: Record<string, unknown>, step: GuideStep): boolean {
  const v = device[step.field];
  if (step.kind === 'photo') return Array.isArray(v) && v.length > 0;
  if (step.kind === 'money' || step.kind === 'number') return Number(v) > 0;
  return typeof v === 'string' && v.trim().length > 0 && !/^tbd$/i.test(v.trim());
}

/**
 * How far through the whole walk we are. Optional steps count toward the total
 * so the bar does not jump, but they never block moving on.
 */
export function guideProgress(
  devices: Record<string, unknown>[], script: GuideStep[],
): { answered: number; total: number; percent: number } {
  const required = script.filter((s) => !s.optional);
  const total = devices.length * required.length;
  const answered = devices.reduce(
    (n, d) => n + required.filter((s) => isAnswered(d, s)).length, 0,
  );
  return { answered, total, percent: total === 0 ? 0 : Math.round((answered / total) * 100) };
}

/** Devices with every required question answered. "3 of 7 done." */
export function devicesComplete(
  devices: Record<string, unknown>[], script: GuideStep[],
): number {
  const required = script.filter((s) => !s.optional);
  return devices.filter((d) => required.every((s) => isAnswered(d, s))).length;
}

/**
 * Carry the last device's answers forward as the starting point for the next.
 * Most cameras on one job are the same dome at the same price — asking every
 * question again from scratch is the slow way to record eight identical
 * positions. Location, photos and notes are always cleared: those are the
 * things that genuinely differ.
 */
export function seedFromPrevious<T extends Record<string, unknown>>(
  fresh: T, previous: T | undefined, script: GuideStep[],
): T {
  if (!previous) return fresh;
  const carry: Record<string, unknown> = {};
  for (const step of script) {
    if (step.field === 'location' || step.field === 'photos' || step.field === 'notes') continue;
    const v = previous[step.field];
    if (v !== undefined && v !== null && v !== '') carry[step.field] = v;
  }
  return { ...fresh, ...carry };
}
