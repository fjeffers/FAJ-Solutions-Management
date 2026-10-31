'use client';
// Prompts a tech can't miss (Fred, 2026-10-31: "more in your face for signing
// in ... plus gps from marking home and the site so the app know when they
// arrived"):
//   CheckInNow    full screen when there's a job today and the day hasn't started.
//   ArrivalPrompt full screen when a drive is running and the phone is at the
//                 site (or home). The tap records it, the same as "I have arrived".
//   HomeSpotCard  Profile: save home where the phone is now (kept on this phone).
// A web app only reads GPS while it is open, so the arrival shows when the app
// is on screen, never in the background.
import { useEffect, useMemo, useState } from 'react';
import { Clock, Home, MapPin } from 'lucide-react';
import { arrivalAt, checkInDue, clearHome, drivingJob, loadHome, saveHome, siteSpot, type Fix, type Spot } from '@/lib/arrival';
import { getPosition, noGpsMessage, NO_GPS_MS } from '@/lib/geo';
import { toastError, toastSuccess } from '@/lib/toast';
import { browserStorage } from '@/lib/wf-outbox';
import type { WfJob } from '@/lib/wf';
import { Section } from './WfUi';

const LATER_MS = 30 * 60 * 1000;
const NOT_YET_MS = 5 * 60 * 1000;

function snoozed(key: string): boolean {
  try { return Number(window.sessionStorage.getItem(key)) > Date.now(); } catch { return false; }
}
function snooze(key: string, ms: number): void {
  try { window.sessionStorage.setItem(key, String(Date.now() + ms)); } catch { /* storage blocked */ }
}
const jobName = (j: WfJob) => j.siteName || j.title || `WO ${j.number}`;
const jobAddress = (j: WfJob) => [j.street, j.city, [j.state, j.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');

export function CheckInNow({ jobs, busy, onCheckIn }: { jobs: WfJob[]; busy: boolean; onCheckIn: (job: WfJob) => void }) {
  const job = useMemo(() => checkInDue(jobs), [jobs]);
  const [, setTick] = useState(0);
  if (!job) return null;
  const key = `faj-checkin-later:${job.id}`;
  if (snoozed(key)) return null;
  const time = job.startTime ? ` · starts ${job.startTime}` : '';
  return (
    <div className="fs-takeover" role="dialog" aria-modal="true" aria-label="Time to check in">
      <div className="fs-takeover-card">
        <span className="fs-takeover-icon"><Clock size={40} /></span>
        <h2>Time to check in</h2>
        <p className="fs-takeover-job">{jobName(job)}</p>
        <p className="fs-takeover-meta">WO {job.number}{time}</p>
        {jobAddress(job) && <p className="fs-takeover-meta">{jobAddress(job)}</p>}
        <button type="button" className="fs-takeover-go" disabled={busy} onClick={() => onCheckIn(job)}>Check in now</button>
        <button type="button" className="fs-takeover-later" onClick={() => { snooze(key, LATER_MS); setTick((t) => t + 1); }}>Later</button>
      </div>
    </div>
  );
}

export function ArrivalPrompt({ jobs, uid, busy, onArrive }: { jobs: WfJob[]; uid: string; busy: boolean; onArrive: (job: WfJob) => void }) {
  const driving = useMemo(() => drivingJob(jobs), [jobs]);
  const [here, setHere] = useState<Fix | null>(null);
  const [, setTick] = useState(0);
  const watching = !!driving;
  useEffect(() => {
    if (!watching || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setHere({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      () => { /* no fix: the "I have arrived" button still works */ },
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);
  const home = useMemo(() => loadHome(browserStorage(), uid), [uid]);
  const at = driving && here ? arrivalAt(driving.st, here, siteSpot(driving.job), home) : null;
  const key = driving ? `faj-arrive-later:${driving.job.id}:${driving.st.since}` : '';
  const show = !!at && !snoozed(key);
  useEffect(() => { if (show) navigator.vibrate?.([200, 100, 200]); }, [show]);
  if (!driving || !at || !show) return null;
  const site = at === 'site';
  return (
    <div className="fs-takeover" role="dialog" aria-modal="true" aria-label={site ? "You're at the site" : "You're home"}>
      <div className="fs-takeover-card">
        <span className="fs-takeover-icon">{site ? <MapPin size={40} /> : <Home size={40} />}</span>
        <h2>{site ? "You're at the site" : "You're home"}</h2>
        {site && <p className="fs-takeover-job">{jobName(driving.job)}</p>}
        <p className="fs-takeover-meta">{site ? `WO ${driving.job.number}. Tap to stop the drive and start your time on site.` : 'Tap to end the drive and sign out for the day.'}</p>
        <button type="button" className="fs-takeover-go" disabled={busy} onClick={() => onArrive(driving.job)}>
          {site ? 'Start job' : 'Sign out for the day'}
        </button>
        <button type="button" className="fs-takeover-later" onClick={() => { snooze(key, NOT_YET_MS); setTick((t) => t + 1); }}>Not yet</button>
      </div>
    </div>
  );
}

export function HomeSpotCard({ uid }: { uid: string }) {
  const kv = useMemo(() => browserStorage(), []);
  const [home, setHome] = useState<Spot | null>(() => loadHome(kv, uid));
  const [busy, setBusy] = useState(false);
  const mark = async () => {
    setBusy(true);
    const pos = await getPosition(10_000);
    setBusy(false);
    if (!pos) { toastError(noGpsMessage(), NO_GPS_MS); return; }
    saveHome(kv, uid, pos);
    setHome({ lat: pos.lat, lng: pos.lng });
    toastSuccess('Home saved on this phone.');
  };
  return (
    <Section title="Home location" subtitle="So the app knows when you get home at the end of the day">
      <p className="wf-subtle" style={{ margin: '0 0 10px', fontSize: 12.5 }}>
        {home ? 'Saved on this phone. It is never sent to the office.' : 'Stand at home and tap the button. It stays on this phone only.'}
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="wf-btn wf-btn-navy" disabled={busy} onClick={() => void mark()}>
          <Home size={16} /> {busy ? 'Finding you…' : home ? "I'm home: save it again" : "I'm home: save this spot"}
        </button>
        {home && (
          <button type="button" className="wf-btn wf-btn-ghost" onClick={() => { clearHome(kv, uid); setHome(null); }}>Remove</button>
        )}
      </div>
    </Section>
  );
}
