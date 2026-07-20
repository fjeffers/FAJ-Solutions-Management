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

// Field-common varieties per item type. Shown as a datalist so any custom
// model can also be typed in freely.
export const ITEM_VARIANTS: Record<PlanItemType, string[]> = {
  drop: [
    'Single drop (1x Cat6)', 'Dual drop (2x Cat6)', 'Triple drop (3x Cat6)',
    'Quad drop (4x Cat6)', 'Cat6A shielded drop', 'Fiber drop (SMF)', 'Fiber drop (MMF)',
  ],
  outlet: [
    'Single-port faceplate', 'Dual-port faceplate', 'Quad-port faceplate', '6-port faceplate',
    'Surface-mount biscuit box', 'Floor box', 'Fiber outlet', 'Coax + data combo plate',
  ],
  power: [
    'Duplex 120V', 'Quad 120V', 'Dedicated 20A circuit', '208V circuit',
    'UPS-backed outlet', 'Floor power box', 'Power pole (ceiling drop)', 'Generator-backed',
  ],
  workstation: ['Desktop PC', 'Docking station', 'Thin client', 'POS terminal', 'Kiosk', 'Dual-monitor setup'],
  laptop: ['Windows laptop', 'MacBook', 'Chromebook', 'Tablet'],
  printer: ['Network printer', 'MFP / copier', 'Receipt printer', 'Label printer', 'Plotter', 'USB-shared printer'],
  ap: ['Ceiling-mount AP', 'Wall-mount AP', 'Outdoor AP', 'AP with external antennas', 'Mesh point', 'Wi-Fi 6E AP'],
  rack: [
    '42U 4-post open frame', '24U 4-post open frame', '42U 2-post relay rack',
    '42U enclosed cabinet', '12U wall-mount cabinet', '16U rolling rack', '6U wall bracket', '9U wall-mount cabinet',
  ],
  switch: [
    '8-port unmanaged', '8-port PoE', '16-port managed', '24-port managed', '24-port PoE+',
    '48-port managed', '48-port PoE+', '24-port SFP aggregation', 'Industrial DIN-rail switch', '10G core switch',
  ],
  firewall: ['SMB firewall', 'UTM appliance', 'Router/firewall combo', 'SD-WAN edge', 'VPN concentrator', 'ISP modem/gateway'],
  camera: ['Dome IP camera', 'Bullet IP camera', 'PTZ camera', 'Fisheye 360', 'Doorbell / intercom', 'NVR'],
  tv: ['Conference room display', 'Digital signage', 'Video wall', 'Projector', 'Wireless presenter (Airtame etc.)'],
  phone: ['VoIP desk phone', 'Conference phone', 'Cordless / DECT base', 'Analog line', 'Paging speaker'],
  other: [],
};

export const PLAN_W = 1000;
export const PLAN_H = 700;

export const newPlanId = () => Math.random().toString(36).slice(2, 10);

/** The user's 3D rack builder artifact — racks placed on a plan link out to it. */
export const RACK_BUILDER_URL = 'https://claude.ai/code/artifact/a534163c-509a-4c0e-a8b2-39e477f383af';
