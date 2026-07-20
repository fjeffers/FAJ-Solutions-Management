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
  ap: [
    'Ceiling-mount AP', 'Wall-mount AP', 'Outdoor AP', 'AP with external antennas', 'Mesh point', 'Wi-Fi 6E AP',
    'Cisco Meraki MR36', 'Cisco Meraki MR46', 'Cisco Catalyst 9105AX',
    'FortiAP 231F', 'FortiAP 431F',
    'UniFi U6 Pro', 'UniFi U7 Pro', 'UniFi U6 Mesh', 'Aruba AP-505', 'Ruckus R350',
  ],
  rack: [
    '42U 4-post open frame', '24U 4-post open frame', '42U 2-post relay rack',
    '42U enclosed cabinet', '12U wall-mount cabinet', '16U rolling rack', '6U wall bracket', '9U wall-mount cabinet',
    'APC NetShelter SX 42U', 'Tripp Lite SmartRack 42U', 'StarTech 12U wall-mount',
  ],
  switch: [
    '8-port unmanaged', '8-port PoE', '16-port managed', '24-port managed', '24-port PoE+',
    '48-port managed', '48-port PoE+', '24-port SFP aggregation', 'Industrial DIN-rail switch', '10G core switch',
    'Cisco Catalyst 9200-24P', 'Cisco Catalyst 9200-48P', 'Cisco Catalyst 9300-48P', 'Cisco CBS350-24P',
    'Cisco Meraki MS130-24P', 'Cisco Meraki MS130-48P',
    'FortiSwitch 124F-PoE', 'FortiSwitch 148F-PoE', 'FortiSwitch 424E',
    'UniFi Switch Pro 24 PoE', 'UniFi Switch Pro 48 PoE', 'UniFi Aggregation (USW-Agg)',
    'Aruba 1930 24G PoE', 'Netgear M4250 (AV Line)', 'TP-Link Omada SG3428MP',
  ],
  firewall: [
    'SMB firewall', 'UTM appliance', 'Router/firewall combo', 'SD-WAN edge', 'VPN concentrator', 'ISP modem/gateway',
    'FortiGate 40F', 'FortiGate 60F', 'FortiGate 80F', 'FortiGate 100F',
    'Cisco Firepower 1010', 'Cisco Meraki MX67', 'Cisco Meraki MX85',
    'SonicWall TZ370', 'Palo Alto PA-440', 'WatchGuard Firebox T25',
    'Netgate 6100 (pfSense)', 'UniFi Dream Machine Pro', 'UniFi Gateway Pro',
  ],
  camera: [
    'Dome IP camera', 'Bullet IP camera', 'PTZ camera', 'Fisheye 360', 'Doorbell / intercom', 'NVR',
    'Hikvision dome (DS-2CD21xx)', 'Hikvision bullet (DS-2CD20xx)', 'Hikvision PTZ',
    'Axis dome', 'UniFi Protect G5 Dome', 'UniFi Protect G4 Bullet', 'Verkada CD42',
  ],
  tv: ['Conference room display', 'Digital signage', 'Video wall', 'Projector', 'Wireless presenter (Airtame etc.)'],
  phone: [
    'VoIP desk phone', 'Conference phone', 'Cordless / DECT base', 'Analog line', 'Paging speaker',
    'Cisco 8841', 'Poly VVX 450', 'Yealink T54W', 'Grandstream GRP2615',
  ],
  other: [],
};

export const PLAN_W = 1000;
export const PLAN_H = 700;

export const newPlanId = () => Math.random().toString(36).slice(2, 10);

/** The user's 3D rack builder artifact — racks placed on a plan link out to it. */
export const RACK_BUILDER_URL = 'https://claude.ai/code/artifact/a534163c-509a-4c0e-a8b2-39e477f383af';
