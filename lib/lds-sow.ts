// The LDS church install template (Fred, 2026-10-29: "i want a template with this", with NetView's
// Installer SOW for LDS-1103 Fayetteville, Rev 3.0, and the Vendor Installation & Quality Standards
// Guide v10.11.4). Two halves, one source:
//   - the Installer SOW for a site, under FAJ's name, filled in from the work order
//     (components/SowDocument.tsx), to print or save as a PDF for the techs;
//   - the five days as the job's closeout checklist on the techs' phones (LDS_INSTALL_CHECKLIST,
//     a closeout_lists row picked by keyword, lib/closeout.ts listFor).
// Where the Vendor Guide v10.11.4 changed the SOW (the 10/22/2026 labeling standard, the -67 dBm
// NetSpot minimum, the quality-criteria photos and required documents), this follows the guide.
// Pure; unit-tested in lib/lds-sow.test.ts.
import type { EnrichedWorkOrder } from './types';

export const VENDOR_GUIDE = 'Vendor Installation & Quality Standards Guide v10.11.4';
export const NETSPOT_MIN = '-67 dBm';
export const TOOLS_HUB = 'https://lds-tools-hub.ldsqa.fyi/';

/** An LDS church job, by its own words: its title, description, client ticket or project. */
export function isLdsJob(w: Pick<EnrichedWorkOrder, 'title' | 'description' | 'external_wo_id' | 'project_name'>): boolean {
  const text = [w.title, w.description, w.external_wo_id, w.project_name].filter(Boolean).join(' ');
  return /\bLDS\b|\bLDS-\d|meetinghouse/i.test(text);
}

// ── The site's own details, filled in from the work order ─────────────────

export type SowFields = {
  siteId: string; ticket: string; faWo: string;
  address: string; city: string; state: string; zip: string;
  startDate: string; endDate: string; startTime: string;
  leadTech: string; leadPhone: string; secondTech: string; secondPhone: string;
  lockbox: string; floorplan: string;
  deliverables: string; tools: string; checkout: string;
  fajContact: string; fajPhone: string;
  hotel: string; meals: string; mileage: string;
};

type Tech = { name: string; phone?: string | null };
const md = (d: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? '');
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}` : '';
};
/** "8:00" or "08:00" → "8:00 AM"; anything else as typed. */
const clockOf = (t: string | null | undefined) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t ?? '');
  if (!m) return (t ?? '').trim();
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The SOW's fill-in boxes from the job: the site, the dates, the lead tech and the second, the links. */
export function sowFields(w: Pick<EnrichedWorkOrder,
  'wo_number' | 'client_reference' | 'external_wo_id' | 'site_address' | 'site_city' | 'site_state' | 'site_zip'
  | 'start_date' | 'end_date' | 'start_time' | 'contractor_name' | 'contractor_names' | 'lead_contractor_name'
  | 'access_instructions' | 'deliverable_link' | 'checkout_link'>, techs: Tech[], faj: { name: string; phone: string }): SowFields {
  const names = [...new Set([w.lead_contractor_name, ...(w.contractor_names ?? []), w.contractor_name].map((n) => (n ?? '').trim()).filter(Boolean))];
  const phone = (n: string | undefined) => (n ? techs.find((t) => t.name === n)?.phone?.trim() ?? '' : '');
  return {
    siteId: w.client_reference ?? '', ticket: w.external_wo_id ?? '', faWo: w.wo_number,
    address: w.site_address ?? '', city: w.site_city ?? '', state: w.site_state ?? '', zip: w.site_zip ?? '',
    startDate: md(w.start_date), endDate: md(w.end_date), startTime: clockOf(w.start_time) || '8:00 AM',
    leadTech: names[0] ?? '', leadPhone: phone(names[0]), secondTech: names[1] ?? '', secondPhone: phone(names[1]),
    lockbox: w.access_instructions ?? '', floorplan: '',
    deliverables: w.deliverable_link ?? '', tools: TOOLS_HUB, checkout: w.checkout_link ?? '',
    fajContact: faj.name, fajPhone: faj.phone,
    hotel: '113.00', meals: '50.00', mileage: '0.60',
  };
}

/** "SOW LDS-1103 Site 5333202 — Fayetteville, NC": the PDF's name. */
export function sowFileName(f: Pick<SowFields, 'ticket' | 'siteId' | 'city' | 'state'>): string {
  const where = [f.city, f.state].filter(Boolean).join(', ');
  return ['Installer SOW', f.ticket, f.siteId && `Site ${f.siteId}`].filter(Boolean).join(' ') + (where ? ` — ${where}` : '');
}

// ── The SOW's text ────────────────────────────────────────────────────────

export type SowRow = string[];
export type SowDay = {
  n: number; title: string; intro: string;
  rule?: { title: string; text: string };
  activities: SowRow[];
  /** What the lead tech uploads that day: deliverable, format, acceptance standard. */
  deliverables: SowRow[];
  gate: string;
  signoff: string[];
};

export const SOW_SCOPE = {
  purpose: 'Installers replace the end-of-support network at each assigned Church meetinghouse (firewall, switch, APs), run new Cat6A to every AP and building system, and leave a clean, labeled, tested, and documented install. FAJ Solutions does this work for NetView Inc. under NetView\'s SOW with CompuCom (Q2607-168196); where they conflict, the CompuCom SOW and its Exhibit B govern.',
  facts: [
    ['Customer / Prime', 'The Church of Jesus Christ (via CBRE) / CompuCom Systems, through NetView Inc.'],
    ['Program term', '9/29/2026 – 12/31/2026; all cabling complete by 12/15/2026'],
    ['States', 'NC, SC, NY, NJ'],
    ['Install window', '5 business days per site, Mon–Fri; no install starts on a Friday'],
    ['No-work days', 'Saturdays and Sundays; week of 11/23 (blackout)'],
    ['Hours', 'Arrive 8:00 AM; normal daytime business hours only'],
    ['Wireless target', `${NETSPOT_MIN} or better in every meeting and teaching space (${VENDOR_GUIDE})`],
  ] as SowRow[],
  inScope: [
    'Demo existing firewall, switch, unmanaged hubs, and APs (all Meraki devices with an announced EOS date)',
    'Mount rack (wall-mount, open or lockable) on 3/4" plywood where needed; firewall on its own shelf',
    'Pull Cat6A (plenum where required) to each AP per the heatmap, within 3 ft of the marked location',
    'Pull ~5 additional Cat6A building-system drops: ISP to firewall, AV rack, chapel camera, door control, HVAC',
    'Install new Cat6A modular patch panel and patch cords; re-home existing reachable cables into a Cat6 patch panel',
    'Install customer-provided network equipment and APs per the instruction guide',
    'Patch ceiling holes, blank-plate abandoned outlets, certify-test all new cable, run post-install wireless survey',
  ],
};

/** Cable runs by system (Vendor Guide cable matrix): system, pull new Cat6A?, jack/patch color. */
export const SOW_CABLE_RUNS: SowRow[] = [
  ['Access Points', 'Always, within 3 ft of heatmap spot', 'Blue both ends'],
  ['AV', 'Yes, 1–2 drops. MS130 present: cable and patch to it. MS120: replace with MS130, SFP both ends. Other networked switch: land in the same port the old cable used. BSS Contrio, Ivy, QSC: leave a drop, touch nothing else', 'White'],
  ['HVAC / BMS', 'Yes, if a central Honeywell/Pelican cluster exists, even on short runs. Distributed system: no drop', 'White'],
  ['Fire panel', 'Yes, if present (sprinklers = fire panel)', 'White'],
  ['Security / door', 'Only if a networked door system exists', 'White'],
  ['Chapel PTZ camera', 'Always. Clear Touch RL400/RL500: patch in. No camera or other brand: jack, service loop on J-hook, leave patch cord', 'White'],
  ['IP phones', 'Always (new run, never black work)', 'White'],
  ['Printers', 'FamilySearch (sanctioned), Mission, and Seminary offices only', 'White'],
  ['FamilySearch PCs', 'No run — leave one wireless dongle per PC', '—'],
  ['Black work', 'Existing runs that reach the rack: re-terminate only; not tested or labeled. None if rack relocated', 'Black, bottom patch panel'],
];

export const SOW_CONTACTS: SowRow[] = [
  ['NetView PM', 'Mike Wise', '724-714-7998 · mike.wise@teamnetview.com', 'Schedule, scope questions, daily status, all escalations'],
  ['NetView backup', 'Kristin Solano', '908-770-1075 · kristin.solano@teamnetview.com', 'Backup when the PM is unavailable'],
  ['CompuCom Project Manager', 'Grant Beatton', '331-305-1788 · grant.beatton@compucom.com', 'Building access, floor plans, keys, FM decisions'],
  ['CompuCom Project Coordinator', 'Lauren Fryer', 'Lauren.Fryer@compucom.com', 'Building access, floor plans, keys'],
  ['CompuCom Tech Escalations / QC', 'Vince Carter', '816-694-2595 · Vincent.carter@compucom.com', 'Technical questions — only after the NetView PM approves'],
];

export const SOW_PRE_ARRIVAL = {
  rule: 'A crew that arrives without the items below is turned away, and the return trip is at the installer\'s expense. No floor plan = no cabling.',
  groups: [
    ['Credentials and approvals', [
      'Every tech pre-approved by CompuCom before stepping on site',
      'BICSI credentials: foreman holds Installer 2; all other installers hold Installer 1',
      'Church Code of Conduct and safety standards reviewed',
    ]],
    ['Site package (from FAJ / NetView PM)', [
      'Correct floor plan for the building style',
      'Church AP heatmap / approved AP placement map',
      'Pre-install survey notes and photos for the site',
      'Building access info, Teams chat access, and the Smartsheet checkout link',
    ]],
    ['Materials', [
      'CompuCom cabling materials picked up from Graybar will-call for the week\'s sites',
      'Meraki equipment delivery confirmed (MX67, MS130, CW9172I APs, SFPs) and return packing slip located',
      'Rack (open-frame or lockable), 3/4" plywood backer, white paint for public-space backer board',
      'Cat6A cable (CommScope SYSTIMAX 1091 non-plenum / 2091 plenum), blue and white Cat6A jacks, black jacks + Cat6 panel for black work, biscuit boxes, Cat6A patch cords, J-hooks, sleeves, fire putty, blank faceplates, escutcheon plates',
      'Spare switch in truck stock (for sites reaching 22+ ports)',
    ]],
    ['Tools', [
      'CommScope SL Jack Termination Tool Kit with Lacing Fixture (required)',
      'Fluke DSX2-5000/8000 (or Viavi Certifier10G/40G) with current calibration, set to CommScope SYSTIMAX, Cat6A, cable type 1091/2091',
      'Android device or laptop with paid NetSpot Pro license (iOS not accepted)',
      'Laptop or iPad with independent internet access for CNM, and Church Account login',
      'Machine label printer (no handwritten labels), toner/tracer, ladders/lift, vacuum',
    ]],
  ] as [string, string[]][],
  conduct: [
    'No tobacco, smoking, or dip on Church property — smoke only off-property on the sidewalk.',
    'No coffee or tea of any kind, hot or cold, on Church property.',
    'No Saturday work. Leave the building usable and secure at the end of every day.',
  ],
};

/** The five days at a glance: day, focus, gate to start the next day. */
export const SOW_SCHEDULE: SowRow[] = [
  ['Day 1', 'Assessment, rack approval, labeling, start pathways and AP pulls', 'Rack location approved; floor plan marked; run list and port count accepted'],
  ['Day 2', 'Finish all AP pulls; pull every building-system run; mount and terminate station jacks', '100% of runs pulled and station-terminated, or shortfall plan approved by PM'],
  ['Day 3', 'Rack build, patch panel termination, black work, Fluke certification', '100% of new runs pass Fluke; FLW file saved; cutover window confirmed with PMO'],
  ['Day 4', 'Cutover: MX67, MS130, APs, CNM configuration and port labels; demo old gear', 'All devices green in CNM; connectivity verified; old gear removed from CNM'],
  ['Day 5', 'NetSpot survey, AV and building-system checks, punch list, photos, closeout and sign-off', 'Full closeout package accepted'],
];

const UPLOAD = 'Upload all of today\'s deliverables to the site Gdrive Deliverables link and the customer Site Deliverables page. Report the day in the TEAMS chat, update TrackIt, and check out with the Smartsheet checkout form.';
const CHECKIN: SowRow = ['Teams check-in / Smartsheet check-out', 'Teams chat + Smartsheet form', 'Check-in posted in Teams chat on arrival with tech names; Smartsheet checkout submitted before leaving site. Missing either = day not paid'];

export const SOW_DAYS: SowDay[] = [
  {
    n: 1, title: 'Assessment & start of cabling',
    intro: 'Day 1 is assessment, documentation, and start of cabling. By end of day the rack location is approved, every run is identified and labeled, and AP pathways are started.',
    rule: { title: 'Day 1 network rule', text: 'The existing network stays live all of Day 1. Nothing is demoed, unplugged, or cut over until Day 4.' },
    activities: [
      ['8:00–8:15', 'Arrive & check in', 'Check in via the Teams chat with crew names and arrival time. Confirm keys open all doors (Bishop, Clerk, President offices) — if not, PMO contacts the FM for the master key.', 'Teams check-in posted'],
      ['8:15–8:30', 'Pre-existing damage photos', 'Photograph any existing damage in every area you will work: ceilings, walls, closets, floors.', 'Damage photo set'],
      ['8:30–10:00', 'Building walkthrough', 'Open every door, including doors inside rooms and exterior access. Note ceiling type room by room, attic/mezzanine/crawl access, power, and any equipment in outside electrical rooms. Verify the floor plan matches the building style — if not, stop and use TEAMS chat to report it.', 'Marked-up floor plan'],
      ['8:30–10:00', 'Locate building systems', 'Find and photograph: existing MX/MS gear, AV rack(s) front and back, HVAC (Honeywell/Pelican cluster vs. distributed), fire panel (sprinklers = fire panel), networked door system, chapel camera model, IP phones, printers in FamilySearch/Mission/Seminary offices, FamilySearch placard and PC count.', 'Systems list + photos'],
      ['10:00–10:30', 'Rack location decision', 'Default: keep rack within 3–5 ft of current gear. Locked room = open-frame rack; public space (incl. Materials Center, janitor closet) = lockable enclosed rack. Relocate only for hot, dirty, wet, or exterior-door spaces — scout 1–2 options and report them in TEAMS chat; NetView clears the move with CompuCom PMO/FM. Flag if ISP equipment must move.', 'Approved rack location'],
      ['10:30–11:00', 'CNM snapshot', 'Log into CNM and take a snapshot of the site\'s current config (especially AV ports) before any changes.', 'CNM snapshot saved'],
      ['11:00–12:00', 'Tag existing cables', 'Tone and label every cable entering the closet by destination (AP, Clerk/BP, HVAC/Locks, AV, FHC, S&I, FM/Mission, Public). Decide which runs reach the new rack (black work) and which are abandoned. Leave a port-mapping sheet at the switch.', 'Existing-cable map'],
      ['12:00–12:30', 'Lunch / noon status', 'Use TEAMS chat to report rack decision, run count, blockers.', 'Noon status sent'],
      ['12:30–1:30', 'Run plan & AP layout', 'Mark each AP within 3 ft of its heatmap spot, in the room shown, avoiding line of sight between APs. Build the run list: every AP + AV (1–2), HVAC, fire, door, chapel camera, IP phones, approved printers. Count ports — 22+ in use means a 2nd switch.', 'Run list + port count'],
      ['1:30–4:00', 'Start install', 'Mount backer board (paint white in public spaces) and rack if location is approved. Hang J-hooks every 5 ft along main trunk paths; install sleeves at ceiling penetrations. Begin pulling AP runs (Cat6A, plenum where required), keeping 1 ft from other cable types and off sprinkler, HVAC, and electrical.', 'Rack/backer up; trunk paths started'],
      ['4:00–4:30', 'Clean & secure', 'Remove debris, vacuum work areas, replace ceiling tiles, stage materials neatly out of public areas. Confirm network, HVAC, door control, and AV still work. Lock all doors.', 'Building usable and secure for next day'],
      ['4:30–5:00', 'Upload, report & check out', UPLOAD, 'Day 1 uploaded; checked out'],
    ],
    deliverables: [
      CHECKIN,
      ['Approved rack location', 'Photo + one line', 'Location named; open vs. lockable rack stated; any relocation approved by CompuCom PMO/FM in writing'],
      ['Marked-up floor plan', 'PDF or photo', 'Rack location, every AP position (AP-01, AP-02…), every building-system drop, and pathway routes drawn'],
      ['Run list & port count', 'Spreadsheet or Smartsheet checkout form', 'One row per run (AP-01…, AV-01/02, HVAC, Fire, Door, Chapel Cam, IP Phone, Printer); plenum Y/N; total ports in use; 2nd switch Y/N'],
      ['Pre-existing condition photos', 'Labeled photo set', 'Every damaged area, plus existing network rack, AV rack front/back, HVAC, fire panel, chapel camera'],
      ['Building-systems findings', 'Short checklist', 'Present / not present: AV switch model (MS130 / MS120 / other / none), HVAC (central vs. distributed), fire panel, networked door system, camera model, FamilySearch + PC count, IP phones, approved printers'],
      ['CNM pre-change snapshot', 'Screenshot or export', 'Taken before any CNM change; AV port config visible'],
      ['Day 1 status & blockers', 'TrackIt entry + TEAMS chat report', 'Work completed, AP pulls started vs. total, materials short, issues needing PMO/FM decision'],
      ['Deliverables uploaded', 'Gdrive + customer website', 'All Day 1 deliverables uploaded to the site Gdrive Deliverables link and the customer Site Deliverables page'],
    ],
    gate: 'Day 2 work does not start until the check-in, rack location, floor plan and run list are accepted.',
    signoff: ['All Day 1 deliverables uploaded to Gdrive and the customer Site Deliverables page; reported in TEAMS chat', 'Existing network, HVAC, door control, and AV still working', 'Work areas clean, ceiling tiles back, materials staged out of public areas', 'Building locked; Smartsheet checkout form submitted'],
  },
  {
    n: 2, title: 'Cable pulls & station terminations',
    intro: 'Day 2 is the heavy pulling day. By end of day every new Cat6A run on the approved run list is pulled, supported, and terminated at the station end with a labeled jack.',
    rule: { title: 'Pull standard', text: 'J-hooks every 5 ft, 1 ft from all other cable, never on ceiling grid, sprinkler pipe, HVAC, or electrical. Runs that miss this standard are re-pulled at the installer\'s expense.' },
    activities: [
      ['8:00–8:15', 'Check in & huddle', 'Check in via the Teams chat. Review any Day 1 feedback. Confirm the run list and assign runs between the two techs.', 'Teams check-in posted'],
      ['8:15–12:00', 'Finish AP pulls', 'Pull every remaining AP run (Cat6A; plenum where required) from the rack location to within 3 ft of each heatmap spot. Hang every bundle on J-hooks every 5 ft; keep bundles to 25 cables or fewer. Leave a service loop hung on a J-hook at each AP and a 10 ft service loop at the rack, Velcro-secured. Install a vertical sleeve where bundles penetrate a ceiling; 1 in sleeve + fire putty for single cables.', 'All AP runs pulled'],
      ['12:00–12:30', 'Lunch / noon status', 'Use TEAMS chat to report runs pulled vs. total, blockers, any material shortage.', 'Noon status sent'],
      ['12:30–3:00', 'Building-system pulls', 'Pull new Cat6A to each system found on Day 1: AV rack (1–2 drops), HVAC/BMS cluster, fire panel, networked door system, chapel camera (no camera: run to the side closest to the network rack and coil enough cable to reach the center of the chapel), IP phones, and approved printers (FamilySearch, Mission, Seminary). No run to FamilySearch PCs.', 'All system runs pulled'],
      ['3:00–4:00', 'Station terminations', 'Terminate the station end with the CommScope SL tool kit: blue jacks for APs, white for all other runs. Pair untwist ≤ 1/8 in; jacket within 1 in of termination. Mount each jack in a biscuit box screwed to the surface. Apply machine-printed labels per the labeling standard below. Leave a patch cord at every jack not yet in use.', 'Jacks mounted and labeled'],
      ['4:00–4:30', 'Clean & secure', 'Vacuum, replace every ceiling tile, stage cable reels and boxes out of public areas. Confirm the existing network, HVAC, door control, and AV still work. Lock all doors.', 'Building usable and secure'],
      ['4:30–5:00', 'Upload, report & check out', UPLOAD, 'Day 2 uploaded; checked out'],
    ],
    deliverables: [
      CHECKIN,
      ['Updated run list', 'Spreadsheet or Smartsheet checkout form', 'Every run marked Pulled Y/N and Station-terminated Y/N; final run count; plenum Y/N per run'],
      ['Pathway photos', 'Labeled photo set', 'Each trunk run showing J-hooks every 5 ft and cable separation; each ceiling penetration with sleeve or fire putty'],
      ['Station jack photos', 'Labeled photo set', 'Each jack mounted in a biscuit box, labeled, with patch cord attached; AP drops show service loop on J-hook'],
      ['Material usage & shortages', 'Short list', 'Cat6A footage used, jacks, J-hooks, patch cords used vs. on hand; anything short for Days 3–4'],
      ['Day 2 status & blockers', 'TrackIt entry + text to PM', 'Runs pulled vs. total, issues needing PMO/FM decision'],
      ['Deliverables uploaded', 'Gdrive + customer website', 'All Day 2 deliverables uploaded to the site Gdrive Deliverables link and the customer Site Deliverables page'],
    ],
    gate: 'Day 3 rack work does not start until the run list shows 100% of runs pulled and station-terminated, or the PM has approved a plan to finish the shortfall.',
    signoff: ['All Day 2 deliverables uploaded to Gdrive and the customer Site Deliverables page', 'Existing network, HVAC, door control, and AV still working', 'All ceiling tiles back; no cable or debris left in public areas', 'Building locked; Smartsheet checkout form submitted'],
  },
  {
    n: 3, title: 'Rack build, termination & certification',
    intro: 'Day 3 builds the rack, terminates the patch panel, re-homes black work, and certifies every new run. The existing network stays live; new equipment is not installed until Day 4.',
    rule: { title: 'Testing standard', text: 'Fluke set to CommScope SYSTIMAX, Category 6A, cable type 1091 (non-plenum) or 2091 (plenum). Patch cords in line. Every run must pass with headroom better than 1 dB (target 3.0 dB+). Star passes are not accepted.' },
    activities: [
      ['8:00–8:15', 'Check in & huddle', 'Check in via the Teams chat. Confirm the Day 2 run list is 100% pulled. Ask PMO to confirm the Day 4 cutover window with the FM.', 'Cutover window requested'],
      ['8:15–10:00', 'Rack build', 'Finish backer board (white paint in public spaces). Mount the rack: open-frame in a locked room, lockable enclosed in public space. Build the elevation top to bottom: Cat6A patch panel, space for MS130 switch, shelf for MX67 (nothing stacked on or under it), Cat6 black-work panel, PDU. Bond the rack per SOW Exhibit B (green-insulated ground).', 'Rack built per elevation'],
      ['10:00–12:00', 'Patch panel termination', 'Dress new runs into the rack in bundles of 25 or fewer and terminate on the Cat6A modular panel: AP ports first (blue), then all other new runs (white). Pair untwist ≤ 1/8 in; bend radius ≥ 4× cable OD. Label each panel port P1-01 (panel + port only) and wrap-label each cable behind the panel where it is visible without cutting ties.', 'Panel terminated and labeled'],
      ['12:00–12:30', 'Lunch / noon status', 'Use TEAMS chat to report rack status, termination count, cutover window status.', 'Noon status sent'],
      ['12:30–1:30', 'Black work', 'If the rack stayed in place: re-terminate each existing run that reaches the rack onto black jacks in the bottom Cat6 panel, using black patch cords only. Pair-map check only; no certification or labeling. If the rack relocated: no black work — all old runs are abandoned and removed on Day 4.', 'Black work re-terminated'],
      ['1:30–3:30', 'Fluke certification', 'Certify every new run with patch cords in line. Test labels must match cable labels exactly. Re-terminate and re-test any failure; replace cable that still fails. Save every result.', '100% pass; FLW saved'],
      ['3:30–4:00', 'Patch cords & port plan', 'Machine-label new Cat6A patch cords with the 3-label standard below for Day 4 patching. Confirm final port count: 22 or more ports in use means a 2nd switch — tell FAJ and the NetView PM now.', 'Port plan final'],
      ['4:00–4:30', 'Clean & secure', 'Clean the rack area of all scraps, packaging, and spare parts; vacuum; replace ceiling tiles. Confirm existing network, HVAC, door control, and AV work. Lock all doors.', 'Building usable and secure'],
      ['4:30–5:00', 'Upload, report & check out', UPLOAD, 'Day 3 uploaded; checked out'],
    ],
    deliverables: [
      CHECKIN,
      ['Rack photos (pre-equipment)', 'Labeled photo set', 'Full rack wide shot and close-up showing panel labels and cable dressing; backer board and rack type visible'],
      ['Fluke results', 'FLW file + PDF report', 'Every new run listed; all pass with > 1 dB headroom; labels match cable labels; tester model, serial, and calibration date shown'],
      ['Fail / re-test log', 'Short list', 'Each run that failed, the fix made, and the re-test result'],
      ['Black work count', 'One line', 'Number of existing runs re-terminated, or "none — rack relocated"'],
      ['Cutover window & port plan', 'Text to PM', 'Cutover date/time confirmed by PMO; final ports in use; 2nd switch Y/N'],
      ['Day 3 status & blockers', 'TrackIt entry + text to PM', 'Work completed; anything that threatens Day 4'],
      ['Deliverables uploaded', 'Gdrive + customer website', 'All Day 3 deliverables uploaded to the site Gdrive Deliverables link and the customer Site Deliverables page'],
    ],
    gate: 'Day 4 cutover does not start until the Fluke results and the cutover window are accepted — every new run passes and the window is confirmed with the PMO/FM.',
    signoff: ['All Day 3 deliverables uploaded to Gdrive and the customer Site Deliverables page', 'Existing network, HVAC, door control, and AV still working', 'Rack area clean — no loose parts or packaging', 'Building locked; Smartsheet checkout form submitted'],
  },
  {
    n: 4, title: 'Cutover, CNM configuration & demolition',
    intro: 'Day 4 swaps the network. New firewall, switch, and APs go live, CNM is configured and labeled, and old equipment and abandoned cable come out. The building network must be fully back up before the crew leaves.',
    rule: { title: 'Cutover rule', text: 'Cut over only inside the window the PMO confirmed with the FM. Label every existing cable before you unplug it. The network, HVAC, door control, and AV must all be working before check-out — if not, call FAJ and the NetView PM before leaving site.' },
    activities: [
      ['8:00–8:15', 'Check in & confirm window', 'Check in via the Teams chat and confirm with the PMO that the cutover window is still good. Have a laptop or iPad with independent internet and Church Account access to CNM.', 'Window confirmed'],
      ['8:15–8:30', 'Pre-cutover', 'Open the Day 1 CNM snapshot. Photograph the existing rack as-is. Confirm every cable on the old gear is labeled.', 'Pre-cutover photos'],
      ['8:30–9:30', 'Firewall', 'If the site has an MX64, MX65, or MX68: in CNM use Replace (RMA) with the new MX67 serial. Move the ISP line to the MX67 Internet port and wait for solid white. MX67 sits alone on its shelf. MX75/85/95/105/250/450 stay in place.', 'Firewall online'],
      ['9:30–11:00', 'Switch', 'Add the MS130 in CNM by serial. Connect firewall Port 2 to SFP 25 on the switch (no SFP: use an access port set to Link). Patch APs from Port 1 up and facility devices (HVAC, door, fire) from Port 24 down, using the Day 3 labeled cords. 2nd switch if 22+ ports: SFP 26 on switch 1 to SFP 9 on switch 2. Wait for solid white.', 'Switch online'],
      ['11:00–12:00', 'AV rack', 'MS130 in AV rack: patch to it, SFP both ends. MS120 in AV rack: replace with MS130, SFP both ends. Other networked switch: land the new run in the same port the old cable used. BSS Contrio, Ivy, QSC: leave the drop only; touch nothing else.', 'AV connected'],
      ['12:00–12:30', 'Lunch / noon status', 'Use TEAMS chat to report firewall and switch status, any device not green.', 'Noon status sent'],
      ['12:30–2:00', 'APs', 'Add each CW9172I in CNM by serial with its AP label. Mount on the ceiling surface at the marked location; patch with blue cords. Confirm green or blue status light. Label each AP with AP number + last 4 of MAC; record full serials for the as-built.', 'All APs online'],
      ['2:00–2:45', 'CNM ports & labels', 'Set every port role (AP, Facility, Public, Workforce, IoT, Link, Disabled). Label every port (AP1, AP2…, BMS, AV, Fire, Chapel Cam, FS). Make AV ports match the Day 1 snapshot; AV switch uplink in the Link zone. Everything must show green.', 'CNM all green'],
      ['2:45–3:45', 'Demolition', 'Remove old firewall, MS120s, unmanaged hubs, and old APs; remove each from CNM and confirm by serial. Pull old AP cables back toward the closet as far as possible. Rack relocated: fully remove all cable to the old location — no cut-and-abandon. Remove small switches in Clerk\'s office and FamilySearch. Blank faceplates on every removed jack.', 'Old gear and cable out'],
      ['3:45–4:15', 'Connectivity & return prep', 'Verify guest Wi-Fi and wired clerk computers reach ComeUntoChrist.org. Pull all SFPs from old gear; box old Meraki/Cisco gear with the return label. Leave old personal hubs boxed near the rack. Leave one FamilySearch wireless dongle per PC.', 'Connectivity verified'],
      ['4:15–4:30', 'Clean & secure', 'Clean rack area and demo areas; vacuum; replace ceiling tiles. Confirm HVAC, door control, and AV work. Lock all doors.', 'Building usable and secure'],
      ['4:30–5:00', 'Upload, report & check out', UPLOAD, 'Day 4 uploaded; checked out'],
    ],
    deliverables: [
      CHECKIN,
      ['CNM screenshots', 'Screenshots', 'Firewall, switch(es), and every AP green; port roles and labels visible; AV ports match the Day 1 snapshot'],
      ['Installed device list', 'Spreadsheet', 'MX67, MS130(s), and each AP with AP number, room, and full serial / MAC'],
      ['Connectivity confirmation', 'Text to PM', 'Guest Wi-Fi and wired clerk computer both reach ComeUntoChrist.org'],
      ['Removed device list', 'Spreadsheet', 'Serial of every old device removed, confirmed gone from CNM; SFPs pulled and retained'],
      ['Demo photos', 'Labeled photo set', 'Blank faceplates installed; old equipment location cleared; return box labeled'],
      ['Day 4 status & blockers', 'TrackIt entry + text to PM', 'Anything not green or not working; building systems check result'],
      ['Deliverables uploaded', 'Gdrive + customer website', 'All Day 4 deliverables uploaded to the site Gdrive Deliverables link and the customer Site Deliverables page'],
    ],
    gate: 'Day 5 closeout does not start until the CNM screenshots and the connectivity confirmation are accepted — CNM shows all green with labeled ports and connectivity is verified.',
    signoff: ['All Day 4 deliverables uploaded to Gdrive and the customer Site Deliverables page', 'Network, HVAC, door control, and AV all working', 'Old equipment boxed for return; rack area clean', 'Building locked; Smartsheet checkout form submitted'],
  },
  {
    n: 5, title: 'Validation, punch list & closeout',
    intro: 'Day 5 proves the install and closes the site. The crew surveys wireless coverage, checks every AV and building system, works the punch list, and submits the full closeout package before leaving.',
    rule: { title: 'No partial closeout', text: 'The crew does not leave site until the Church acceptance checklist and Final Site Closure Checklist are complete and signed. Missing items mean a return trip at the installer\'s expense.' },
    activities: [
      ['8:00–8:15', 'Check in & huddle', 'Check in via the Teams chat. Review any Day 4 feedback. Confirm CNM is still all green.', 'Teams check-in posted'],
      ['8:15–9:30', 'NetSpot survey', `On an Android device or laptop (not iOS) with NetSpot Pro, start in one corner and walk a zig-zag pattern through every accessible room, hallway, and office, including the full chapel and the pulpit. Hold the device still during readings; keep doors and windows as found. Every area must read ${NETSPOT_MIN} or better — call FAJ and the NetView PM if any area falls short.`, `Heatmap ≥ ${NETSPOT_MIN}`],
      ['9:30–11:00', 'AV & building-system checks', 'Work Church acceptance items 8–15: pulpit mic and pulpit up/down; audio in overflow and cultural hall (open first partition past the sensor); Relief Society and Primary rooms set to chapel; touch panels; BSS Contrio panels; ListenWIFI app; Bluetooth modules; Clear Touch PTZ camera controls; HDMI distribution (laptop to one input, verify on one output). Confirm HVAC and door control work.', 'Checklist items 8–15 done'],
      ['11:00–12:00', 'Punch list', 'Patch every ceiling hole or cover with an escutcheon plate; all ceiling tiles back; blank faceplates installed; every jack, cord, and panel label readable; cable dressing tidy; FamilySearch dongles left (one per PC).', 'Punch list clear'],
      ['12:00–12:30', 'Lunch / noon status', 'Use TEAMS chat to report NetSpot result, any failed system check.', 'Noon status sent'],
      ['12:30–1:45', 'Closeout photos', 'All photos labeled, per the quality criteria below: equipment close-ups, data/DMARC handoff, service loops, cable management, AP heatmap validation, AP close-up and distance, trunk runs, patch cable labels, patch panel labels, rack close-up and wide angle.', 'Photo set complete'],
      ['1:45–2:45', 'Build closeout package', 'Floor plan / AP diagram (AP locations, MAC addresses, closet locations); dated NetSpot heatmap (and full PDF report, optional); Fluke FLW project file + PDF report; Day 4 device lists.', 'Package assembled'],
      ['2:45–3:45', 'Checklists & sign-off', 'Complete the Church acceptance checklist (all 15 items) and the Final Site Closure Checklist. Lead and secondary tech sign. Vacuum and clean all work areas.', 'Signed checklists'],
      ['3:45–4:30', 'Final walkthrough', 'Lead Tech walks the whole building one last time: tiles, faceplates, debris, rack area, doors locked. Confirm network, HVAC, door control, and AV are working.', 'Site left clean'],
      ['4:30–5:00', 'Upload, report & check out', 'Upload the full closeout package to the site Gdrive Deliverables link and the customer Site Deliverables page. Report the site complete in TEAMS chat, update TrackIt, and check out with the Smartsheet checkout form.', 'Closeout uploaded; checked out'],
    ],
    deliverables: [
      ['NetSpot heatmap', 'Image + NetSpot file', `Dated; taken after cutover; ${NETSPOT_MIN} or better throughout (full NetSpot PDF report optional)`],
      ['Floor plan / AP diagram (as-built)', 'PDF or marked-up plan', 'Dated; AP locations with MAC addresses; closet and rack locations; patch panel connections'],
      ['Cable test results', 'Fluke FLW project file + PDF report', 'Final set from Day 3, including any re-tests'],
      ['Closeout photos', 'Labeled photo set', 'All 10 quality criteria below'],
      ['Church acceptance checklist', 'Signed form', 'All 15 items marked'],
      ['Final Site Closure Checklist', 'Signed form', 'Lead and secondary tech signatures'],
      ['Final status', 'TrackIt entry + text to PM', 'Site complete; open items (if any) and owner'],
      ['Deliverables uploaded', 'Gdrive + customer website', 'The full closeout package uploaded to the site Gdrive Deliverables link and the customer Site Deliverables page'],
    ],
    gate: 'The site is not complete until the closeout package is accepted.',
    signoff: ['Full closeout package uploaded to Gdrive and the customer Site Deliverables page', 'Network, HVAC, door control, and AV all working', 'All work areas vacuumed; no debris, scraps, or spare parts left', 'Building locked; Smartsheet checkout form submitted'],
  },
];

/** The Vendor Guide v10.11.4 quality criteria: the closeout photos. */
export const SOW_QUALITY_PHOTOS = [
  'Equipment close-ups', 'Data / DMARC handoff', 'Service loops', 'Cable management', 'AP heatmap validation',
  'AP close-up and distance', 'Trunk runs', 'Patch cable labels', 'Patch panel labels', 'Rack close-up and wide angle',
];
/** The Vendor Guide v10.11.4 required documents. */
export const SOW_REQUIRED_DOCS = [
  'Floor plan / AP diagram (AP locations, MAC addresses, closet locations)', 'NetSpot full PDF report (optional)',
  'NetSpot heatmap', 'Fluke FLW project file', 'Fluke PDF report',
];

export const SOW_STANDARDS = {
  colorNote: 'Color exceptions for product shortages: all-blue site, or blue APs + white everything else (light gray cords OK on white jacks). Anything else needs CompuCom PMO approval.',
  workmanship: [
    'Cat6A for all new structured cable and all patch cords; never reuse existing patch cords',
    'Terminate with the CommScope SL tool kit; pair untwist ≤ 1/8 in; bend radius ≥ 4× cable OD; pull tension ≤ 25 lbf',
    'J-hooks every 5 ft; service loops hung on J-hooks; 10 ft service loop at the rack',
    '1 ft separation from audio, fire, and other cable; never rest on ceiling grid, sprinkler pipe, HVAC, or electrical',
    'Vertical sleeve where bundles penetrate a ceiling; 1 in sleeve + fire putty for single cables',
    'Jacks in biscuit boxes, screwed to the surface; surface raceway only as a last resort with CompuCom approval',
    'Firewall on its own shelf — nothing stacked on or under the MX67',
    'APs mounted on the ceiling surface, no line of sight between APs',
  ],
  labeling: [
    'Machine-printed labels only; every label wraps around the cable — no flag labels',
    'End-user drops (jacks and biscuit boxes): function only — AP-01, AV, Printer; no port numbers',
    'Patch panel ports: P1-01 (panel + port only) — no device names, switch ports, or far-end information',
    'Biscuit drop patch cords, 3 labels: near the switch SW1-01, middle P1-01, near the device AP01',
    'Patch cables from the switch, 3 labels: near the patch panel P1-01, middle SW1-01, near the device AP01',
    'Each AP: AP number + last 4 of MAC; device serials in capital letters, dark font on white label',
    'Fluke test labels must match cable labels exactly',
  ],
  demolition: [
    'Remove old AP cables as far back as possible, ideally to the closet',
    'If the rack relocated, fully remove all cable to the old location — cutting and abandoning is not allowed',
    'Blank faceplates on every removed jack; patch or escutcheon-plate every ceiling hole',
    'Remove small switches from Clerk\'s office and FamilySearch',
    'Pull SFPs from old gear before return; ship old Meraki/Cisco gear via UPS on the supplied return label; leave old personal hubs boxed near the rack',
  ],
};

export const SOW_CLOSEOUT: SowRow[] = [
  ['Cable test results', 'Fluke, CommScope SYSTIMAX, Cat6A, cable type 1091/2091; patch cords in line; headroom > 1 dB (target 3.0 dB+); no star passes; labels match. FLW project file + PDF report', 'Before leaving site'],
  ['NetSpot heatmap', `Taken after CNM cutover on Android or laptop; zig-zag walk of every accessible room incl. chapel and pulpit; ${NETSPOT_MIN} or better everywhere; dated`, 'Before leaving site'],
  ['Floor plan / AP diagram', 'Dated; rack and closet locations, AP locations, full AP serial numbers and MAC addresses, patch panel connections', 'Before leaving site'],
  ['CNM', 'All old APs, switches, firewalls removed (verified by serial); all ports labeled (AP1, AP2, BMS, AV, Fire, Chapel Cam, FS); all devices green', 'Before leaving site'],
  ['Closeout photos (all labeled)', 'The 10 quality criteria: equipment close-ups, data/DMARC handoff, service loops, cable management, AP heatmap validation, AP close-up and distance, trunk runs, patch cable labels, patch panel labels, rack close-up and wide angle', 'Before leaving site'],
  ['Church acceptance checklist', 'All 15 items checked, incl. pulpit mic and up/down, overflow and cultural hall audio, touch panels, BSS panels, ListenWIFI, Bluetooth, Clear Touch camera, HDMI distribution', 'Before leaving site'],
  ['Final Site Closure Checklist', 'Lead and secondary tech signatures', 'Before leaving site'],
  ['Old equipment return', 'SFPs removed; return label on box; dropped at UPS', 'Within the week'],
];

export const SOW_OUT_OF_SCOPE = [
  'Member-purchased equipment (any camera not Clear Touch or Sony, personal devices)',
  'AV programming or reconfiguring QSC, BSS Contrio, or Ivy systems',
  'Printers outside FamilySearch, Mission, and Seminary offices (unless the FM directs)',
  'Re-pulling existing cables that don\'t reach the rack',
  'ISP equipment relocation (Telco), surface raceway, additional switches beyond the 22-port rule',
  'Weekend, after-hours, or blackout-week work',
];

export const SOW_ESCALATION = [
  'Lead Tech → FAJ Solutions and the NetView PM (Mike Wise, 724-714-7998) — immediately, for anything that blocks the 5-day plan',
  'NetView PM → Kristin Solano (backup, 908-770-1075) if no response in 30 minutes',
  'NetView PM → CompuCom Project Manager (Grant Beatton) and Project Coordinator (Lauren Fryer) for access, floor plans, FM decisions',
  'NetView PM → Vince Carter (CompuCom Technical Escalations/QC) for technical or standards questions',
];

// ── The five days as the techs' checklist ─────────────────────────────────

/**
 * The closeout checklist for an LDS church install: each day's deliverables and sign-off, then the
 * Vendor Guide's quality-criteria photos and required documents, in the order the days run. Ticked
 * on the tech's phone; the job isn't done until each is ticked or skipped with a reason, so the
 * guide's optional NetSpot PDF report is left off (Greptile on PR #34). At most 60 items and 200
 * characters each (wf_tech_closeout).
 */
export const LDS_INSTALL_CHECKLIST: string[] = [
  'Day 1 · Teams check-in on arrival; Smartsheet checkout before leaving',
  'Day 1 · Rack location approved: photo + open or lockable rack',
  'Day 1 · Floor plan marked: rack, every AP (AP-01…), every system drop, pathways',
  'Day 1 · Run list and port count: plenum Y/N, 2nd switch Y/N (22+ ports)',
  'Day 1 · Damage photos, plus existing network rack, AV rack, HVAC, fire panel, chapel camera',
  'Day 1 · Building systems listed: AV switch, HVAC, fire panel, door system, camera, FamilySearch PCs, IP phones, printers',
  'Day 1 · CNM snapshot before any change (AV ports visible)',
  'Day 1 · Uploaded to Gdrive and Site Deliverables; status in TrackIt and Teams; building locked',
  'Day 2 · Teams check-in on arrival; Smartsheet checkout before leaving',
  'Day 2 · Run list updated: every run pulled and station-terminated',
  'Day 2 · Pathway photos: J-hooks every 5 ft; sleeve or fire putty at each penetration',
  'Day 2 · Jack photos: biscuit box, function label, patch cord; AP service loop on J-hook',
  'Day 2 · Material used, and anything short for Days 3–4',
  'Day 2 · Uploaded to Gdrive and Site Deliverables; status in TrackIt; tiles back; building locked',
  'Day 3 · Teams check-in on arrival; Smartsheet checkout before leaving',
  'Day 3 · Rack photos before equipment: wide shot and panel-label close-up',
  'Day 3 · Fluke: every new run passes with > 1 dB headroom; labels match; FLW + PDF saved',
  'Day 3 · Fail / re-test log',
  'Day 3 · Black work count (or "none — rack relocated")',
  'Day 3 · Cutover window confirmed with PMO; port plan; 2nd switch Y/N',
  'Day 3 · Uploaded to Gdrive and Site Deliverables; status in TrackIt; rack area clean; building locked',
  'Day 4 · Teams check-in on arrival; Smartsheet checkout before leaving',
  'Day 4 · CNM screenshots: firewall, switch(es), every AP green; ports labeled; AV ports match Day 1',
  'Day 4 · Installed device list: MX67, MS130(s), each AP with number, room, serial and MAC',
  'Day 4 · Guest Wi-Fi and clerk computer reach ComeUntoChrist.org',
  'Day 4 · Removed device list: every old serial, gone from CNM; SFPs pulled',
  'Day 4 · Demo photos: blank faceplates, old gear cleared, return box labeled',
  'Day 4 · Uploaded to Gdrive and Site Deliverables; status in TrackIt; network, HVAC, door, AV working; building locked',
  'Day 5 · Teams check-in on arrival; Smartsheet checkout before leaving',
  `Day 5 · NetSpot heatmap after cutover, dated, ${NETSPOT_MIN} or better everywhere`,
  'Day 5 · Floor plan / AP diagram: AP locations, MAC addresses, closet locations',
  'Day 5 · Fluke FLW project file and PDF report (final, with re-tests)',
  ...SOW_QUALITY_PHOTOS.map((p) => `Day 5 · Photo: ${p}`),
  'Day 5 · Church acceptance checklist: all 15 items, signed',
  'Day 5 · Final Site Closure Checklist signed by the lead and second tech',
  'Day 5 · Old equipment boxed with the return label, SFPs pulled',
  'Day 5 · Full closeout package uploaded to Gdrive and Site Deliverables; final status in TrackIt',
  'Day 5 · Network, HVAC, door, AV working; vacuumed; building locked',
];

/**
 * The closeout list row: picked for any LDS job that isn't a survey (the Site survey list sorts first).
 * Keywords match inside words (lib/closeout.ts listFor), so "lds-" (the ticket, LDS-1103) and not "lds",
 * which is in "fields" and "builds". Seeded by supabase-migration-145-lds-install-list.sql.
 */
export const LDS_INSTALL_LIST = { name: 'LDS church install (5 days)', keywords: ['lds-', 'meetinghouse'], sort: 3 };
