'use client';
// Add an expense, from the tech app (migration-103): snap the receipt, say what
// it was for, and send it to Fred. Mileage asks for the miles and the day
// instead, and adds them to the tech's day (lib/day-miles.ts). Its own file so
// it can be tested; app/tech/page.tsx opens it.
//
// Mileage from the phone (Fred, 2026-11-02: "they just need to add a upload from
// phone them it automatically calculate the milage and then it asked for what
// date"): the tech picks the start and end odometer photos, the AI reads them,
// the miles are end less start and the day is the photos'. The photos go to the
// job's photos under the tech, stamped with their time and GPS and the miles.
import { useEffect, useRef, useState } from 'react';
import { Camera, Car, Receipt } from 'lucide-react';
import type { WfJob } from '@/lib/wf';
import type { OdometerRead, ReceiptRead } from '@/lib/photo-read';
import type { PhotoTime } from '@/lib/photo-time';
import { photoTakenAt } from '@/lib/photo-time';
import { dayOf } from '@/lib/project-day';
import { getPosition, noGpsMessage, NO_GPS_MS, stampLines } from '@/lib/geo';
import { fmtMoney } from '@/lib/utils';
import { shrinkPhoto, stampPhoto } from '@/lib/photo-stamp';
import { useExpenseCategories } from '@/lib/use-expense-categories';
import { toastError, toastSuccess } from '@/lib/toast';
import { parseExpenseAmount, type ExpenseCategory } from '@/lib/expenses';
import { parseMiles } from '@/lib/day-miles';
import { Dialog } from '@/components/wf/WfUi';
import { readPhoto, type OdometerMoment, type SavePhoto } from '@/components/wf/Odometer';

type OdoShot = { photo: Blob; preview: string; read: number | null; taken: PhotoTime };
const TZ = 'America/New_York';
const ODO_TITLE: Record<OdometerMoment, string> = { start: 'Starting mileage', end: 'Ending mileage' };

/** Snap the receipt, say what it was for, and send it to Fred. Needs signal. */
export default function ExpenseDialog({ job, initialFile, initialCategory = 'materials', keep, onClose, onSaved }: {
  job: WfJob; initialFile?: File | null;
  /** Keeps the odometer photos with the job (the tech app's job photos). */
  keep?: SavePhoto;
  /** A fuel or materials stop opens the receipt under its own category. */
  initialCategory?: ExpenseCategory;
  onClose: () => void; onSaved: () => void;
}) {
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory>(initialCategory);
  const categories = useExpenseCategories().list;
  const [vendor, setVendor] = useState('');
  const [date, setDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const [note, setNote] = useState('');
  const [gallons, setGallons] = useState('');
  // Mileage asks for the miles, not an amount and a store, and adds them to the
  // day's miles, not a receipt (Fred, 2026-10-27: "for mileage ... it's supposed
  // to basically go to mileage"). lib/day-miles.ts.
  const [miles, setMiles] = useState('');
  const mileage = category === 'mileage';
  const [odo, setOdo] = useState<Partial<Record<OdometerMoment, OdoShot>>>({});
  const odoRef = useRef(odo);
  const [odoBusy, setOdoBusy] = useState<OdometerMoment | null>(null);
  useEffect(() => () => { for (const s of Object.values(odoRef.current)) if (s) URL.revokeObjectURL(s.preview); }, []);
  const [busy, setBusy] = useState(false);
  // What the AI read off the photo (lib/photo-read.ts): it fills the form, the tech checks it.
  const [ai, setAi] = useState<ReceiptRead | null>(null);
  const [reading, setReading] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const takePhoto = async (f: File | undefined) => {
    if (!f) return;
    try {
      const small = await shrinkPhoto(f);
      setPhoto(small);
      setPreview(URL.createObjectURL(small));
      setReading(true);
      const r = await readPhoto<ReceiptRead>(job.number, 'receipt', small);
      setReading(false);
      setAi(r);
      if (!r) return;
      if (r.amount != null) setAmount(r.amount.toFixed(2));
      if (r.vendor) setVendor(r.vendor);
      if (r.date) setDate(r.date);
      if (r.category) setCategory(r.category);
      if (r.gallons != null) setGallons(String(r.gallons));
    } catch (e) {
      setReading(false);
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    }
  };

  // A photo taken from the job's Photo icon and marked Receipt: read it at once.
  const started = useRef(false);
  useEffect(() => {
    if (initialFile && !started.current) { started.current = true; void takePhoto(initialFile); }
  }, [initialFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickOdo = async (moment: OdometerMoment, f: File | undefined) => {
    if (!f) return;
    setOdoBusy(moment);
    try {
      const taken = await photoTakenAt(f, TZ);
      const small = await shrinkPhoto(f);
      const r = await readPhoto<OdometerRead>(job.number, 'odometer', small);
      const old = odoRef.current[moment];
      if (old) URL.revokeObjectURL(old.preview);
      const next = { ...odoRef.current, [moment]: { photo: small, preview: URL.createObjectURL(small), read: r?.reading ?? null, taken } };
      odoRef.current = next;
      setOdo(next);
      const when = next.start?.taken.at ?? next.end?.taken.at;
      if (when) setDate(dayOf(when, TZ));
      const a = next.start?.read, b = next.end?.read;
      if (a != null && b != null) {
        if (b > a) setMiles(String(Math.round((b - a) * 10) / 10));
        else toastError('The ending odometer is lower than the starting one. Check the photos.');
      }
      if (r?.reading == null) toastError("Couldn't read the odometer on that photo. Try a clearer one, or type the miles.");
    } catch (e) {
      toastError(e instanceof Error ? e.message : "Couldn't use that photo.");
    } finally {
      setOdoBusy(null);
    }
  };

  /** The odometer photos, stamped with their time and GPS, to the job's photos with the miles on them. */
  const keepOdo = async (shots: [OdometerMoment, OdoShot][], mi: number, day: string, here: Awaited<ReturnType<typeof getPosition>>) => {
    if (!keep) return;
    for (const [m, s] of shots) {
      const pos = s.taken.gps ?? here;
      const at = s.taken.at ?? new Date().toISOString();
      const stamped = await stampPhoto(s.photo, stampLines({
        woNumber: job.number, title: `${ODO_TITLE[m]}, added by hand`, at: new Date(at), pos, fromLibrary: !s.taken.at, gpsWhenAdded: !s.taken.gps,
      }));
      const label = `${ODO_TITLE[m]}${s.read != null ? ` ${s.read.toLocaleString('en-US')}` : ''} (${mi} mi added by hand for ${day})`;
      const r = await keep(stamped, label, at, pos);
      if (typeof r === 'object') toastError(r.error);
    }
  };

  const sendMiles = async () => {
    const mi = parseMiles(miles);
    if (mi == null) { toastError('Enter the miles, like 85.'); return; }
    setBusy(true);
    const shots = (['start', 'end'] as const).flatMap((m): [OdometerMoment, OdoShot][] => (odo[m] && keep ? [[m, odo[m]!]] : []));
    // Every picture carries its GPS (Fred, 2026-10-27): the photo's own, else where the phone is now.
    const here = shots.some(([, s]) => !s.taken.gps) ? await getPosition(8000) : null;
    if (shots.some(([, s]) => !s.taken.gps) && !here) { setBusy(false); toastError(noGpsMessage(), NO_GPS_MS); return; }
    const fd = new FormData();
    fd.append('wo_number', job.number);
    fd.append('miles', String(mi));
    fd.append('date', date);
    try {
      const res = await fetch('/api/tech/mileage', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setBusy(false);
      if (!res.ok || !json.ok) { toastError(json.error ?? "Couldn't add the miles."); return; }
      const day = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      await keepOdo(shots, mi, day, here);
      toastSuccess(`${mi} mi added to your miles for ${day}.`);
      onSaved();
    } catch {
      setBusy(false);
      toastError('Miles need signal to send. Try again when you have signal.');
    }
  };

  const send = async () => {
    if (mileage) { await sendMiles(); return; }
    const amt = parseExpenseAmount(amount);
    if (amt == null) { toastError('Enter the amount on the receipt.'); return; }
    setBusy(true);
    const fd = new FormData();
    fd.append('wo_number', job.number);
    fd.append('amount', String(amt));
    fd.append('category', category);
    fd.append('vendor', vendor);
    fd.append('date', date);
    fd.append('note', note);
    if (category === 'fuel' && gallons.trim()) fd.append('gallons', gallons.trim());
    if (ai) fd.append('ai', JSON.stringify(ai));
    if (photo) fd.append('file', new File([photo], 'receipt.jpg', { type: 'image/jpeg' }));
    try {
      const res = await fetch('/api/tech/expense', { method: 'POST', body: fd });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      setBusy(false);
      if (!res.ok || !json.ok) { toastError(json.error ?? "Couldn't send that expense."); return; }
      toastSuccess(`Expense sent: ${fmtMoney(amt)}.`);
      onSaved();
    } catch {
      setBusy(false);
      toastError('Expenses need signal to send. Keep the receipt and try again when you have signal.');
    }
  };

  const label = (t: string) => <span className="wf-label" style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--wf-text)', fontSize: 13 }}>{t}</span>;
  return (
    <Dialog
      title={mileage ? 'Add mileage' : 'Add an expense'}
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || reading || !!odoBusy || !(mileage ? miles : amount).trim()} onClick={() => void send()}>
          {mileage ? <Car size={16} /> : <Receipt size={16} />} {busy ? 'Sending…' : mileage ? 'Add miles' : 'Send'}
        </button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!mileage && <div>
          {label('Receipt photo')}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Receipt" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--wf-line)' }} />
            )}
            <label className="wf-btn wf-btn-outline wf-btn-sm">
              <Camera size={15} /> {preview ? 'Retake' : 'Take photo'}
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takePhoto(f); }} />
            </label>
            <label className="wf-btn wf-btn-ghost wf-btn-sm">
              From phone
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takePhoto(f); }} />
            </label>
          </div>
        </div>}
        {!mileage && (reading || ai) && (
          <div className="wf-subtle" style={{ fontSize: 12.5 }} aria-live="polite">
            {reading ? 'Reading the receipt…' : 'Filled in from the photo. Check each one before you send.'}
          </div>
        )}
        {/* The lines read off the receipt go to the office with it (Fred, 2026-10-22). */}
        {!mileage && !reading && ai && ai.items.length > 0 && (
          <div style={{ border: '1px solid var(--wf-line)', borderRadius: 10, padding: '8px 10px' }}>
            <div className="wf-label" style={{ marginBottom: 4 }}>On the receipt</div>
            {ai.items.map((it, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '2px 0' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{it.qty != null && it.qty !== 1 ? `${it.qty} × ` : ''}{it.name}</span>
                {it.amount != null && <span>{fmtMoney(it.amount)}</span>}
              </div>
            ))}
          </div>
        )}
        <div>
          {label('What was it for?')}
          <div className="wf-filters">
            {/* Fred's list, then the office's own categories (migration 137). */}
            {categories.map((c) => (
              <button key={c.key} className="wf-filter" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>
        {mileage ? (
          <>
            <div>
              {label('Odometer photos from your phone')}
              <div style={{ display: 'flex', gap: 8 }}>
                {(['start', 'end'] as const).map((m) => {
                  const s = odo[m];
                  return (
                    <label key={m} className="wf-btn wf-btn-outline" aria-label={`${ODO_TITLE[m]} photo`}
                      style={{ flex: 1, flexDirection: 'column', gap: 4, padding: 8, minHeight: 92, cursor: 'pointer' }}>
                      <input type="file" accept="image/*" style={{ display: 'none' }} disabled={!!odoBusy}
                        onChange={(e) => { void pickOdo(m, e.target.files?.[0]); e.target.value = ''; }} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {s ? <img src={s.preview} alt="" style={{ width: '100%', height: 56, objectFit: 'cover', borderRadius: 8 }} /> : <Camera size={20} />}
                      <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                        {odoBusy === m ? 'Reading…' : s ? (s.read != null ? s.read.toLocaleString('en-US') : "Couldn't read") : m === 'start' ? 'Start odometer' : 'End odometer'}
                      </span>
                    </label>
                  );
                })}
              </div>
              <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: 4 }}>
                Pick the start and end photos: the app reads them, works out the miles and the day, and sends the photos with them.
              </div>
            </div>
            <label style={{ display: 'block' }}>{label('Miles')}
              <input className="wf-input" inputMode="decimal" placeholder="e.g. 85" value={miles} onChange={(e) => setMiles(e.target.value)} autoFocus />
            </label>
            <div className="wf-subtle" style={{ fontSize: 12.5, marginTop: -6 }}>{"Added to your miles for the day, on top of what's there."}</div>
          </>
        ) : (
          <label style={{ display: 'block' }}>{label('Amount')}
            <input className="wf-input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        )}
        {category === 'fuel' && (
          <label style={{ display: 'block' }}>{label('Gallons')}
            <input className="wf-input" inputMode="decimal" placeholder="e.g. 11.2" value={gallons} onChange={(e) => setGallons(e.target.value)} />
          </label>
        )}
        {!mileage && (
          <label style={{ display: 'block' }}>{label('Store')}
            <input className="wf-input" placeholder="e.g. Home Depot" value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
        )}
        <label style={{ display: 'block' }}>{label(mileage ? 'Day driven' : 'Date on the receipt')}
          <input className="wf-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {!mileage && (
          <label style={{ display: 'block' }}>{label('Note (optional)')}
            <input className="wf-input" placeholder="e.g. 20 Cat6 jacks for the drive-thru run" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
      </div>
    </Dialog>
  );
}
