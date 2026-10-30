-- Migration 145: the LDS church install checklist
--
-- Fred, 2026-10-29: "i want a template with this" (NetView's Installer SOW for
-- LDS-1103 Fayetteville and the Vendor Installation & Quality Standards Guide
-- v10.11.4), the 5-day checklist on the techs' phones. One closeout list, the
-- same items as lib/lds-sow.ts LDS_INSTALL_CHECKLIST (lib/lds-sow.test.ts
-- checks they match). Picked for a job whose title or description has "lds-"
-- (the ticket, LDS-1103) or "meetinghouse"; a survey still gets the Site survey
-- list, which sorts first. Added once for each business that has lists.

INSERT INTO public.closeout_lists (user_id, name, keywords, items, sort)
SELECT o.user_id, 'LDS church install (5 days)', ARRAY['lds-', 'meetinghouse'], ARRAY[
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
    'Day 5 · NetSpot heatmap after cutover, dated, -67 dBm or better everywhere',
    'Day 5 · Floor plan / AP diagram: AP locations, MAC addresses, closet locations',
    'Day 5 · Fluke FLW project file and PDF report (final, with re-tests)',
    'Day 5 · Photo: Equipment close-ups',
    'Day 5 · Photo: Data / DMARC handoff',
    'Day 5 · Photo: Service loops',
    'Day 5 · Photo: Cable management',
    'Day 5 · Photo: AP heatmap validation',
    'Day 5 · Photo: AP close-up and distance',
    'Day 5 · Photo: Trunk runs',
    'Day 5 · Photo: Patch cable labels',
    'Day 5 · Photo: Patch panel labels',
    'Day 5 · Photo: Rack close-up and wide angle',
    'Day 5 · Church acceptance checklist: all 15 items, signed',
    'Day 5 · Final Site Closure Checklist signed by the lead and second tech',
    'Day 5 · Old equipment boxed with the return label, SFPs pulled',
    'Day 5 · Full closeout package uploaded to Gdrive and Site Deliverables; final status in TrackIt',
    'Day 5 · Network, HVAC, door, AV working; vacuumed; building locked'
  ], 3
FROM (SELECT DISTINCT user_id FROM public.closeout_lists) o
WHERE NOT EXISTS (
  SELECT 1 FROM public.closeout_lists c WHERE c.user_id = o.user_id AND c.name = 'LDS church install (5 days)'
);
