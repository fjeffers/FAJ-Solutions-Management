import { describe, it, expect } from 'vitest';
import {
  scriptFor, isAnswered, guideProgress, devicesComplete, seedFromPrevious,
} from './survey-guide';
import { newCamera } from './surveys';
import type { SurveyCamera } from './types';

const script = scriptFor('cameras');
const rec = (c: SurveyCamera) => c as unknown as Record<string, unknown>;

const filled = (over: Partial<SurveyCamera> = {}): SurveyCamera => ({
  ...newCamera(1),
  location: 'Lobby', camera_type: 'Dome', mount: 'Ceiling', placement: 'Indoor',
  cable_run: '25 ft', resolution: '4MP', unit_price: 245, ...over,
});

describe('answering a step', () => {
  it('counts a filled text answer', () => {
    const step = script.find((s) => s.field === 'location')!;
    expect(isAnswered(rec(filled()), step)).toBe(true);
    expect(isAnswered(rec(filled({ location: '   ' })), step)).toBe(false);
  });

  it('does not accept TBD as an answer', () => {
    const step = script.find((s) => s.field === 'cable_run')!;
    expect(isAnswered(rec(filled({ cable_run: 'TBD' })), step)).toBe(false);
    expect(isAnswered(rec(filled({ cable_run: '25 ft' })), step)).toBe(true);
  });

  it('needs a price above zero', () => {
    const step = script.find((s) => s.field === 'unit_price')!;
    expect(isAnswered(rec(filled({ unit_price: 0 })), step)).toBe(false);
    expect(isAnswered(rec(filled({ unit_price: 245 })), step)).toBe(true);
  });

  it('needs at least one photo', () => {
    const step = script.find((s) => s.field === 'photos')!;
    expect(isAnswered(rec(filled({ photos: [] })), step)).toBe(false);
    expect(isAnswered(rec(filled({ photos: ['u'] })), step)).toBe(true);
  });
});

describe('progress through the walk', () => {
  it('is zero with nothing to walk', () => {
    expect(guideProgress([], script)).toEqual({ answered: 0, total: 0, percent: 0 });
  });

  it('reaches 100% when every required question is answered', () => {
    const p = guideProgress([rec(filled())], script);
    expect(p.percent).toBe(100);
  });

  it('optional questions never hold it back', () => {
    // notes and resolution are optional; leaving them empty is still 100%.
    const p = guideProgress([rec(filled({ notes: null, photos: [] }))], script);
    expect(p.percent).toBe(100);
  });

  it('counts finished devices, not questions', () => {
    const devices = [rec(filled()), rec(filled({ location: '' }))];
    expect(devicesComplete(devices, script)).toBe(1);
  });
});

describe('carrying answers to the next device', () => {
  const previous = filled({ camera_type: 'Turret', mount: 'Wall', unit_price: 480 });

  it('carries the settings that repeat across a job', () => {
    const seeded = seedFromPrevious(rec(newCamera(2)), rec(previous), script) as unknown as SurveyCamera;
    expect(seeded.camera_type).toBe('Turret');
    expect(seeded.mount).toBe('Wall');
    expect(seeded.unit_price).toBe(480);
  });

  it('never carries the things that genuinely differ', () => {
    const seeded = seedFromPrevious(
      rec(newCamera(2)),
      rec(filled({ location: 'Lobby', notes: 'drop ceiling', photos: ['u'] })),
      script,
    ) as unknown as SurveyCamera;
    expect(seeded.location).toBe('');
    expect(seeded.notes).toBeNull();
    expect(seeded.photos).toEqual([]);
  });

  it('leaves the first device alone', () => {
    const fresh = newCamera(1);
    expect(seedFromPrevious(rec(fresh), undefined, script)).toEqual(rec(fresh));
  });
});
