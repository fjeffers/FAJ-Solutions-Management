import { describe, it, expect } from 'vitest';
import { polylineLength, unitsToFeet, withServiceLoop, cat6Boxes } from './floorplan';

describe('cable-run math', () => {
  it('measures a polyline of several segments', () => {
    expect(polylineLength([{ x: 0, y: 0 }, { x: 30, y: 40 }])).toBe(50);
    expect(polylineLength([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }])).toBe(150);
    expect(polylineLength([{ x: 5, y: 5 }])).toBe(0);
  });

  it('converts plan units to feet only when calibrated', () => {
    expect(unitsToFeet(100, 10)).toBe(10);
    expect(unitsToFeet(100, null)).toBeNull();
    expect(unitsToFeet(100, 0)).toBeNull();
  });

  it('adds a 15% service loop', () => {
    expect(withServiceLoop(100)).toBeCloseTo(115);
  });

  it('rounds boxes of Cat6 up from looped footage', () => {
    expect(cat6Boxes(0)).toBe(0);
    expect(cat6Boxes(800)).toBe(1);   // 920 ft with loop
    expect(cat6Boxes(900)).toBe(2);   // 1035 ft with loop
    expect(cat6Boxes(2000)).toBe(3);  // 2300 ft with loop
  });
});
