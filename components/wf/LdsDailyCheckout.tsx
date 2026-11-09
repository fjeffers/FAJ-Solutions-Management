'use client';
// The LDS daily checkout in the tech app: the day comes from the job dates,
// AP runs branch one answer at a time, and every photo is labeled.
import { useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, Loader2 } from 'lucide-react';
import {
  DAY_ONE_EVIDENCE, FINAL_EVIDENCE, MATERIAL_EVIDENCE, apRuns, effectiveProgress, ldsInstallDay, ldsSections,
  progressAlert, visibleApFields, type LdsApRun, type LdsDailyCheckout as Checkout, type LdsEvidence, type YesNo,
} from '@/lib/lds-daily-checkout';
import { fetchLdsDailyCheckout, saveLdsDailyCheckout } from '@/lib/tech-portal';
import { toastError, toastSuccess } from '@/lib/toast';
import type { WfJob } from '@/lib/wf';

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

function blank(job: WfJob, day: string): Checkout {
  const installDay = ldsInstallDay(job.date, job.endDate, day);
  return {
    installDay, day, progress: 'on_track', progressNote: '', blocker: '', blockerType: [], blockerNote: '',
    plannedApCount: 1, aps: apRuns(1),
    day1: { floorPlanMatches: '', mdfLocation: '', firePanelPresent: '', churchCameraPresent: '', familyHistoryPresent: '', existingRack: '', existingSwitchCount: null, evidence: [] },
    materials: { arrived: '', packingListPhoto: '', received: '', missing: '', shortageTomorrow: '', evidence: [] },
    final: { decomComplete: '', oldApsRemoved: '', oldCableRemoved: '', oldSwitchesRemoved: '', systemUp: '', wifiVerified: '', heatmapComplete: '', flukeFilesComplete: '', punchList: '', evidence: [] },
    workCompleted: '', planTomorrow: '', generalEvidence: [],
  };
}

export default function LdsDailyCheckout({ job, canEdit, upload }: {
  job: WfJob; canEdit: boolean;
  /** Takes, stamps and sends one labeled photo; returns its URL. */
  upload: (label: string, file: File) => Promise<string | null>;
}) {
  const day = useMemo(today, []);
  const [c, setC] = useState<Checkout>(() => blank(job, day));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchLdsDailyCheckout(job.number, day).then((row) => {
      if (!live) return;
      if (row?.data) setC({ ...blank(job, day), ...row.data, installDay: ldsInstallDay(job.date, job.endDate, day) });
      setSubmitted(row?.submitted_at ?? null);
    }).catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [job, day]);

  const sections = ldsSections(c.installDay);
  const alert = progressAlert(c);
  const set = (patch: Partial<Checkout>) => setC((x) => ({ ...x, ...patch }));
  const setAp = (i: number, patch: Partial<LdsApRun>) => setC((x) => ({ ...x, aps: x.aps.map((a, n) => (n === i ? { ...a, ...patch } : a)) }));

  const addEvidence = async (label: string, file: File | undefined, put: (e: LdsEvidence) => void) => {
    if (!file) return;
    setBusy(label);
    const url = await upload(`Day ${c.installDay} · ${label}`, file);
    setBusy(null);
    if (url) put({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label, url, takenAt: new Date().toISOString() });
  };

  const save = async (submit: boolean) => {
    setSaving(true);
    try {
      const row = await saveLdsDailyCheckout(job.number, day, { ...c, progress: effectiveProgress(c) }, submit);
      setSubmitted(row.submitted_at);
      if (submit) void fetch('/api/tech/lds-checkout-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ wo_number: job.number, day }) }).catch(() => {});
      toastSuccess(submit ? 'Daily checkout sent to the office.' : 'Saved.');
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't save the checkout.");
    }
    setSaving(false);
  };

  const yn = (label: string, v: YesNo, on: (v: YesNo) => void) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 5 }}>{label} <span style={{ color: '#B91C1C' }}>*</span></div>
      <div className="wf-filters">
        {(['yes', 'no'] as const).map((o) => (
          <button key={o} type="button" className="wf-filter" aria-pressed={v === o} disabled={!canEdit} onClick={() => on(o)}>{o === 'yes' ? 'Yes' : 'No'}</button>
        ))}
      </div>
    </div>
  );
  const text = (label: string, v: string, on: (v: string) => void, required = false) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <span style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>{label}{required && <span style={{ color: '#B91C1C' }}> *</span>}</span>
      <textarea className="wf-input" rows={2} value={v} disabled={!canEdit} onChange={(e) => on(e.target.value)} />
    </label>
  );
  const photo = (label: string, list: LdsEvidence[], put: (e: LdsEvidence) => void) => {
    const have = list.filter((e) => e.label === label);
    return (
      <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ flex: '1 1 160px', fontWeight: 600 }}>{label}{have.length > 0 && <CheckCircle2 size={14} color="#15803D" style={{ marginLeft: 6, verticalAlign: -2 }} />}</span>
        {have.map((e) => (
          // eslint-disable-next-line @next/next/no-img-element
          <a key={e.id} href={e.url} target="_blank" rel="noopener noreferrer"><img src={e.url} alt={label} style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8 }} /></a>
        ))}
        {canEdit && (
          <label className="wf-btn wf-btn-outline wf-btn-sm">
            {busy === label ? <Loader2 size={14} /> : <Camera size={14} />} {have.length ? 'Add another' : 'Take photo'}
            <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void addEvidence(label, f, put); }} />
          </label>
        )}
      </div>
    );
  };
  const box: React.CSSProperties = { padding: 12, border: '1px solid var(--wf-line)', borderRadius: 12, marginBottom: 12, background: 'white' };
  const h = (t: string) => <div style={{ fontWeight: 800, fontSize: 14.5, marginBottom: 10 }}>{t}</div>;

  if (loading) return <div className="fs-card" style={{ padding: 14 }}><Loader2 size={16} /> Loading today&apos;s checkout…</div>;

  return (
    <section className="fs-card" aria-label="LDS daily checkout" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontWeight: 850, fontSize: 17 }}>{c.installDay === 'return' ? 'Return visit' : `Day ${c.installDay}`} checkout</div>
        <span className="wf-subtle" style={{ fontSize: 12.5 }}>{submitted ? `Sent ${new Date(submitted).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : day}</span>
      </div>

      <div style={box}>
        {h('Schedule')}
        <div className="wf-filters" style={{ marginBottom: 10 }}>
          {([['on_track', 'On track'], ['at_risk', 'At risk'], ['behind', 'Behind']] as const).map(([v, l]) => (
            <button key={v} type="button" className="wf-filter" aria-pressed={c.progress === v} disabled={!canEdit} onClick={() => set({ progress: v })}>{l}</button>
          ))}
        </div>
        {yn('Anything blocking the work today?', c.blocker, (v) => set({ blocker: v }))}
        {(c.blocker === 'yes' || c.progress !== 'on_track') && text('What is holding it up?', c.blockerNote, (v) => set({ blockerNote: v }), true)}
        {alert
          ? <div style={{ color: '#B45309', fontWeight: 700, fontSize: 13 }}>{alert}</div>
          : <div style={{ color: '#15803D', fontWeight: 700, fontSize: 13 }}>On schedule. Materials in hand, pushing through.</div>}
      </div>

      {sections.includes('walkthrough') && (
        <div style={box}>
          {h('Day 1 walkthrough')}
          {yn('Does the floor plan match the building?', c.day1.floorPlanMatches, (v) => set({ day1: { ...c.day1, floorPlanMatches: v } }))}
          {text('Where is the MDF?', c.day1.mdfLocation, (v) => set({ day1: { ...c.day1, mdfLocation: v } }), true)}
          {yn('Fire panel inside?', c.day1.firePanelPresent, (v) => set({ day1: { ...c.day1, firePanelPresent: v } }))}
          {yn('Church (chapel) camera?', c.day1.churchCameraPresent, (v) => set({ day1: { ...c.day1, churchCameraPresent: v } }))}
          {yn('Family History room?', c.day1.familyHistoryPresent, (v) => set({ day1: { ...c.day1, familyHistoryPresent: v } }))}
          {yn('Existing rack?', c.day1.existingRack, (v) => set({ day1: { ...c.day1, existingRack: v } }))}
          {DAY_ONE_EVIDENCE.map((l) => photo(l, c.day1.evidence, (e) => setC((x) => ({ ...x, day1: { ...x.day1, evidence: [...x.day1.evidence, e] } }))))}
        </div>
      )}

      {sections.includes('materials') && (
        <div style={box}>
          {h('Materials')}
          {yn('Did materials arrive today?', c.materials.arrived, (v) => set({ materials: { ...c.materials, arrived: v } }))}
          {c.materials.arrived === 'yes' && <>
            {MATERIAL_EVIDENCE.map((l) => photo(l, c.materials.evidence, (e) => setC((x) => ({ ...x, materials: { ...x.materials, evidence: [...x.materials.evidence, e] } }))))}
            {text('What did you get?', c.materials.received, (v) => set({ materials: { ...c.materials, received: v } }), true)}
            {text("What's missing or damaged?", c.materials.missing, (v) => set({ materials: { ...c.materials, missing: v } }))}
          </>}
          {yn('Short on anything for tomorrow?', c.materials.shortageTomorrow, (v) => set({ materials: { ...c.materials, shortageTomorrow: v } }))}
        </div>
      )}

      {sections.includes('runs') && (
        <div style={box}>
          {h('AP cable runs')}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontWeight: 600 }}>
            How many APs on this site?
            <select className="wf-input" style={{ width: 90 }} value={c.plannedApCount} disabled={!canEdit}
              onChange={(e) => { const n = Number(e.target.value); set({ plannedApCount: n, aps: apRuns(n, c.aps) }); }}>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
            </select>
          </label>
          {c.aps.map((ap, i) => {
            const f = visibleApFields(ap);
            return (
              <details key={ap.id} open={i === 0} style={{ borderTop: '1px solid var(--wf-line)', padding: '8px 0' }}>
                <summary style={{ fontWeight: 750, cursor: 'pointer' }}>{ap.name}</summary>
                <div style={{ paddingTop: 8 }}>
                  {yn('Cable pulled?', ap.cablePulled, (v) => setAp(i, { cablePulled: v }))}
                  {f.includes('pullReason') && text('Why not?', ap.pullReason, (v) => setAp(i, { pullReason: v }), true)}
                  {f.includes('footage') && (
                    <label style={{ display: 'block', marginBottom: 10 }}>
                      <span style={{ display: 'block', fontWeight: 600, marginBottom: 5 }}>Length of the run (ft) <span style={{ color: '#B91C1C' }}>*</span></span>
                      <input className="wf-input" inputMode="decimal" value={ap.footage ?? ''} disabled={!canEdit}
                        onChange={(e) => setAp(i, { footage: e.target.value === '' ? null : Number(e.target.value) || 0 })} />
                    </label>
                  )}
                  {f.includes('pullPhoto') && photo(`${ap.name} pulled`, ap.evidence, (e) => setAp(i, { evidence: [...ap.evidence, e] }))}
                  {f.includes('terminated') && yn('Terminated?', ap.terminated, (v) => setAp(i, { terminated: v }))}
                  {f.includes('terminationReason') && text('Why not terminated?', ap.terminationReason, (v) => setAp(i, { terminationReason: v }), true)}
                  {f.includes('labeledEndToEnd') && yn('Labeled end to end?', ap.labeledEndToEnd, (v) => setAp(i, { labeledEndToEnd: v }))}
                  {f.includes('labelingReason') && text('Why not labeled?', ap.labelingReason, (v) => setAp(i, { labelingReason: v }), true)}
                  {f.includes('tested') && yn('Tested?', ap.tested, (v) => setAp(i, { tested: v }))}
                  {f.includes('testResult') && (
                    <div className="wf-filters" style={{ marginBottom: 10 }}>
                      {(['pass', 'fail'] as const).map((r) => (
                        <button key={r} type="button" className="wf-filter" aria-pressed={ap.testResult === r} disabled={!canEdit} onClick={() => setAp(i, { testResult: r })}>{r === 'pass' ? 'Passed' : 'Failed'}</button>
                      ))}
                    </div>
                  )}
                  {f.includes('testNotes') && text(ap.tested === 'no' ? 'Why not tested?' : 'Test notes', ap.testNotes, (v) => setAp(i, { testNotes: v }), ap.tested === 'no' || ap.testResult === 'fail')}
                  {f.includes('finishedPhoto') && photo(`${ap.name} finished`, ap.evidence, (e) => setAp(i, { evidence: [...ap.evidence, e] }))}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {(sections.includes('decom') || sections.includes('final_closeout')) && (
        <div style={box}>
          {h(c.installDay === 5 ? 'Day 5 · Decom and closeout' : 'Closeout')}
          {sections.includes('decom') && <>
            {yn('Decom complete?', c.final.decomComplete, (v) => set({ final: { ...c.final, decomComplete: v } }))}
            {yn('Old APs removed?', c.final.oldApsRemoved, (v) => set({ final: { ...c.final, oldApsRemoved: v } }))}
            {yn('Old cable removed?', c.final.oldCableRemoved, (v) => set({ final: { ...c.final, oldCableRemoved: v } }))}
            {yn('Old switches removed?', c.final.oldSwitchesRemoved, (v) => set({ final: { ...c.final, oldSwitchesRemoved: v } }))}
          </>}
          {yn('System up and running?', c.final.systemUp, (v) => set({ final: { ...c.final, systemUp: v } }))}
          {yn('Wi-Fi verified throughout?', c.final.wifiVerified, (v) => set({ final: { ...c.final, wifiVerified: v } }))}
          {yn('Heatmap complete?', c.final.heatmapComplete, (v) => set({ final: { ...c.final, heatmapComplete: v } }))}
          {yn('Fluke files saved?', c.final.flukeFilesComplete, (v) => set({ final: { ...c.final, flukeFilesComplete: v } }))}
          {text('Punch list remaining', c.final.punchList, (v) => set({ final: { ...c.final, punchList: v } }))}
          {FINAL_EVIDENCE.map((l) => photo(l, c.final.evidence, (e) => setC((x) => ({ ...x, final: { ...x.final, evidence: [...x.final.evidence, e] } }))))}
        </div>
      )}

      <div style={box}>
        {h('Today')}
        {text('What got done today?', c.workCompleted, (v) => set({ workCompleted: v }), true)}
        {text('Plan for tomorrow', c.planTomorrow, (v) => set({ planTomorrow: v }))}
        {photo('Problem photo', c.generalEvidence, (e) => setC((x) => ({ ...x, generalEvidence: [...x.generalEvidence, e] })))}
      </div>

      {canEdit && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="wf-btn wf-btn-outline" disabled={saving} onClick={() => void save(false)}>Save</button>
          <button type="button" className="wf-btn wf-btn-navy" disabled={saving || !c.workCompleted.trim()} onClick={() => void save(true)}>
            {saving ? <Loader2 size={16} /> : <CheckCircle2 size={16} />} Send daily checkout
          </button>
        </div>
      )}
    </section>
  );
}
