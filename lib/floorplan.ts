// Shared catalog for the floor-plan site survey (migration-037).
// Kept out of the components so the 2D editor doesn't pull in three.js.
import type { PlanItemType } from './types';

export const ITEM_META: Record<PlanItemType, { label: string; color: string; glyph: string }> = {
  drop:        { label: 'Network Drop',   color: '#0D7377', glyph: 'D' },
  outlet:      { label: 'Network Outlet', color: '#14b8b8', glyph: 'N' },
  power:       { label: 'Power Outlet',   color: '#f59e0b', glyph: '⚡' },
  workstation: { label: 'Workstation',    color: '#2563eb', glyph: 'W' },
  laptop:      { label: 'Laptop',         color: '#3b82f6', glyph: 'L' },
  printer:     { label: 'Printer',        color: '#7c3aed', glyph: 'P' },
  ap:          { label: 'Wi-Fi AP',       color: '#059669', glyph: 'A' },
  rack:        { label: 'Rack',           color: '#1f2937', glyph: 'R' },
  switch:      { label: 'Switch',         color: '#0891b2', glyph: 'S' },
  firewall:    { label: 'Firewall',       color: '#dc2626', glyph: 'F' },
  camera:      { label: 'Camera',         color: '#db2777', glyph: 'C' },
  tv:          { label: 'TV / Display',   color: '#64748b', glyph: 'T' },
  phone:       { label: 'VoIP Phone',     color: '#a16207', glyph: '☎' },
  other:       { label: 'Other',          color: '#6b7280', glyph: '•' },
};

export const PLAN_W = 1000;
export const PLAN_H = 700;

export const newPlanId = () => Math.random().toString(36).slice(2, 10);

/** The user's 3D rack builder artifact — racks placed on a plan link out to it. */
export const RACK_BUILDER_URL = 'https://claude.ai/code/artifact/a534163c-509a-4c0e-a8b2-39e477f383af';
