import { describe, it, expect } from 'vitest';
import { sanitizeVision } from './survey-vision';

describe('what the photo reader is allowed to say', () => {
  it('keeps the fields it is meant to fill', () => {
    expect(sanitizeVision({
      location: 'Office hallway',
      camera_type: 'Dome',
      mount: 'Ceiling',
      placement: 'Indoor',
      pathway_notes: 'Drop ceiling, accessible plenum',
      materials_needed: 'Ceiling mount, junction box',
      notes: 'Low ceiling, watch the sprinkler head',
    })).toEqual({
      location: 'Office hallway',
      camera_type: 'Dome',
      mount: 'Ceiling',
      placement: 'Indoor',
      pathway_notes: 'Drop ceiling, accessible plenum',
      materials_needed: 'Ceiling mount, junction box',
      notes: 'Low ceiling, watch the sprinkler head',
    });
  });

  it('NEVER lets a price through — money is not a guess from a photo', () => {
    const out = sanitizeVision({ location: 'Lobby', unit_price: 245, price: '245' });
    expect(out).toEqual({ location: 'Lobby' });
    expect('unit_price' in out).toBe(false);
  });

  it('never lets a cable length through — a photo cannot see the closet', () => {
    const out = sanitizeVision({ location: 'Lobby', cable_run: '25 ft', run_length: '30 ft' });
    expect(out).toEqual({ location: 'Lobby' });
  });

  it('drops anything not on the allowlist, including invented fields', () => {
    const out = sanitizeVision({
      location: 'Lobby', status: 'Replace', resolution: '4MP',
      position: 9, id: 'hacked', photos: ['x'], somethingMadeUp: 'yes',
    });
    expect(out).toEqual({ location: 'Lobby' });
  });
});

describe('values must come from the real vocabularies', () => {
  it('rejects a camera type the dropdown does not have', () => {
    expect(sanitizeVision({ camera_type: 'Thermal Imaging Array' })).toEqual({});
    expect(sanitizeVision({ camera_type: 'PTZ' })).toEqual({ camera_type: 'PTZ' });
  });

  it('rejects a mount the dropdown does not have', () => {
    expect(sanitizeVision({ mount: 'Magnetic hover bracket' })).toEqual({});
    expect(sanitizeVision({ mount: 'Soffit' })).toEqual({ mount: 'Soffit' });
  });

  it('accepts only Indoor or Outdoor for placement', () => {
    expect(sanitizeVision({ placement: 'Indoor' })).toEqual({ placement: 'Indoor' });
    expect(sanitizeVision({ placement: 'Outdoor' })).toEqual({ placement: 'Outdoor' });
    expect(sanitizeVision({ placement: 'Semi-covered' })).toEqual({});
    expect(sanitizeVision({ placement: 'indoor' })).toEqual({});  // case matters; it feeds a select
  });
});

describe('junk in, nothing out', () => {
  it('survives a non-object', () => {
    expect(sanitizeVision(null)).toEqual({});
    expect(sanitizeVision('a string')).toEqual({});
    expect(sanitizeVision(42)).toEqual({});
    expect(sanitizeVision([])).toEqual({});
  });

  it('ignores non-string values on allowed keys', () => {
    expect(sanitizeVision({ location: 42, notes: { a: 1 }, mount: null })).toEqual({});
  });

  it('drops blanks and the literal string "null"', () => {
    expect(sanitizeVision({ location: '   ', notes: 'null', pathway_notes: 'NULL' })).toEqual({});
  });

  it('trims and caps a runaway answer', () => {
    const out = sanitizeVision({ notes: `  ${'x'.repeat(900)}  ` });
    expect(out.notes).toHaveLength(400);
  });
});
