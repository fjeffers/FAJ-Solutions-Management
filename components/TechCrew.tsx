'use client';
// A crew lead's phone view of a crew project (migrations 087/088):
//   My sites  — log the team's day, snap receipts, see travel against the cap
//   Pick sites — claim an open meetinghouse for a week (one per week)
//   Messages  — the project channel: everyone, Fred only, or one lead
//   Paid      — what FAJ has paid them on crew work
// No rates or margins ever reach this screen; the RPCs do not return them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchCrewSites, fetchCrewTime, fetchCrewReceipts, fetchCrewBoard, fetchCrewMessages,
  logCrewTime, deleteCrewTime, addCrewReceipt, deleteCrewReceipt, claimCrewSite,
  releaseCrewSite, sendCrewMessage, receiptUrl,
  type TechCrewSite, type TechCrewEntry, type TechCrewReceipt, type TechCrewBoard, type TechCrewMessage,
} from '@/lib/crew-portal';
import {
  SITE_STATUS_META, RECEIPT_CATEGORIES, crewReason, hoursBetween, projectWeeks, ymd,
  type CrewReceiptCategory,
} from '@/lib/crew';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { toastError, toastSuccess } from '@/lib/toast';
import { MapPin, Clock, Camera, Calendar, Send, Trash2, Receipt, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

type Sub = 'sites' | 'pick' | 'messages';

export default function TechCrew() {
  const [sub, setSub] = useState<Sub>('sites');
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<TechCrewSite[]>([]);
  const [entries, setEntries] = useState<TechCrewEntry[]>([]);
  const [receipts, setReceipts] = useState<TechCrewReceipt[]>([]);
  const [boards, setBoards] = useState<TechCrewBoard[]>([]);

  const reload = useCallback(async () => {
    try {
      const [s, e, r, b] = await Promise.all([fetchCrewSites(), fetchCrewTime(), fetchCrewReceipts(), fetchCrewBoard()]);
      setSites(s); setEntries(e); setReceipts(r); setBoards(b);
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Couldn't load your project");
    }
    setLoading(false);
  }, []);

  useEffect(() => { reload(); }, [reload]);

  if (loading) return <Muted>Loading your project…</Muted>;
  if (boards.length === 0) {
    return <Muted>You&apos;re not on a crew project yet. Fred will add you to a team.</Muted>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        <Pill on={sub === 'sites'} onClick={() => setSub('sites')}>My sites</Pill>
        <Pill on={sub === 'pick'} onClick={() => setSub('pick')}>Pick sites</Pill>
        <Pill on={sub === 'messages'} onClick={() => setSub('messages')}>Messages</Pill>
      </div>

      {sub === 'sites' && (
        sites.length === 0 ? (
          <Muted>No sites on your schedule yet. Open <b>Pick sites</b> to choose your weeks.</Muted>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {sites.map((s) => (
              <SiteCard key={s.id} site={s}
                entries={entries.filter((e) => e.site_id === s.id)}
                receipts={receipts.filter((r) => r.site_id === s.id)}
                onChanged={reload} />
            ))}
          </div>
        )
      )}

      {sub === 'pick' && boards.map((b) => <PickBoard key={b.id} board={b} onChanged={reload} />)}

      {sub === 'messages' && boards.map((b) => <Channel key={b.id} board={b} />)}
    </div>
  );
}

// ── My sites ────────────────────────────────────────────────────────────────

function SiteCard({ site, entries, receipts, onChanged }: {
  site: TechCrewSite; entries: TechCrewEntry[]; receipts: TechCrewReceipt[]; onChanged: () => void;
}) {
  const [open, setOpen] = useState<'none' | 'hours' | 'receipt'>('none');
  const [showLog, setShowLog] = useState(false);
  const meta = SITE_STATUS_META[site.status];
  const spent = Number(site.travel_spent);
  const cap = Number(site.travel_cap);
  const where = [site.address, site.city, [site.state, site.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const mapUrl = where ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(where)}` : null;

  return (
    <div className="glass card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{site.name}</div>
          {site.week_start && (
            <div style={{ fontSize: 12, color: '#777', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Calendar size={12} /> Cabling week of {fmtDate(site.week_start)}
            </div>
          )}
          {(site.property_id || site.survey_date) && (
            <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
              {site.property_id && <>Property ID {site.property_id}</>}
              {site.property_id && site.survey_date && ' · '}
              {site.survey_date && <>Survey {fmtDate(site.survey_date)}</>}
            </div>
          )}
          {where && (
            <a href={mapUrl ?? undefined} target="_blank" rel="noreferrer"
              style={{ fontSize: 12, color: 'var(--teal)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={12} /> {where}
            </a>
          )}
        </div>
        <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: meta.bg, color: meta.color, flexShrink: 0 }}>
          {meta.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
        <MiniStat label="Hours logged" value={`${Number(site.hours_logged)}`} />
        <MiniStat label="Travel used" value={`${fmtMoney(spent)} of ${fmtMoney(cap)}`}
          warn={spent > cap * 0.85} />
      </div>
      {spent > cap && (
        <div style={{ marginTop: 6, fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>
          Over the travel cap by {fmtMoney(spent - cap)}. NetView will not reimburse the overage.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center', minWidth: 130 }}
          onClick={() => setOpen(open === 'hours' ? 'none' : 'hours')}>
          <Clock size={14} /> Log hours
        </button>
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center', minWidth: 130 }}
          onClick={() => setOpen(open === 'receipt' ? 'none' : 'receipt')}>
          <Camera size={14} /> Add receipt
        </button>
      </div>

      {open === 'hours' && <HoursForm site={site} entries={entries} onDone={() => { setOpen('none'); onChanged(); }} />}
      {open === 'receipt' && <ReceiptForm site={site} onDone={() => { setOpen('none'); onChanged(); }} />}

      {(entries.length > 0 || receipts.length > 0) && (
        <button onClick={() => setShowLog((v) => !v)}
          style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--teal)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}>
          {showLog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {entries.length} day{entries.length === 1 ? '' : 's'} · {receipts.length} receipt{receipts.length === 1 ? '' : 's'}
        </button>
      )}
      {showLog && <SiteLog entries={entries} receipts={receipts} onChanged={onChanged} />}
    </div>
  );
}

function HoursForm({ site, entries, onDone }: { site: TechCrewSite; entries: TechCrewEntry[]; onDone: () => void }) {
  const today = ymd(new Date());
  const [date, setDate] = useState(today);
  const existing = entries.find((e) => e.work_date === date);
  const [start, setStart] = useState(existing?.start_time?.slice(0, 5) ?? '07:00');
  const [end, setEnd] = useState(existing?.end_time?.slice(0, 5) ?? '');
  const [hoursTyped, setHoursTyped] = useState(existing ? String(existing.hours) : '');
  const [helper, setHelper] = useState(existing?.helper_present ?? true);
  const [note, setNote] = useState(existing?.note ?? '');
  const [saving, setSaving] = useState(false);

  const fromClock = hoursBetween(start, end);
  const hours = fromClock ?? (hoursTyped ? Number(hoursTyped) : NaN);

  const save = async () => {
    if (!Number.isFinite(hours) || hours <= 0) { toastError('Enter a finish time after the start, or type the hours.'); return; }
    if (hours > 16) { toastError('More than 16 hours in a day? Check the times.'); return; }
    setSaving(true);
    const r = await logCrewTime({ siteId: site.id, date, start, end: end || null, hours, helper, note });
    setSaving(false);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    toastSuccess(`${hours} hours saved for ${fmtDate(date)}`);
    onDone();
  };

  return (
    <div style={FORM_BOX}>
      <Field label="Date">
        <input className="input" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </Field>
      {existing && (
        <div style={{ fontSize: 12, color: '#b45309' }}>
          You already logged {Number(existing.hours)} hrs for this day. Saving replaces it.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Start"><input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Finish"><input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      {fromClock == null && (
        <Field label="Or type total hours">
          <input className="input" inputMode="decimal" value={hoursTyped} onChange={(e) => setHoursTyped(e.target.value)} placeholder="8.5" />
        </Field>
      )}
      {fromClock != null && <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--teal)' }}>{fromClock} hours</div>}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={helper} onChange={(e) => setHelper(e.target.checked)} style={{ width: 18, height: 18 }} />
        Helper worked today{site.helper_name ? ` (${site.helper_name})` : ''}
      </label>
      <Field label="What got done (optional)">
        <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pulled 9 runs, mounted rack" />
      </Field>
      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ justifyContent: 'center' }}>
        {saving ? <Loader2 size={14} className="spin" /> : <Clock size={14} />} {saving ? 'Saving…' : 'Save hours'}
      </button>
    </div>
  );
}

function ReceiptForm({ site, onDone }: { site: TechCrewSite; onDone: () => void }) {
  const [date, setDate] = useState(ymd(new Date()));
  const [category, setCategory] = useState<CrewReceiptCategory>('hotel');
  const [vendor, setVendor] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const preview = useMemo(() => (file && file.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const save = async () => {
    const amt = Number(amount.replace(/[$,]/g, ''));
    if (!file) { toastError('Take a photo of the receipt. NetView needs it to reimburse you.'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { toastError('Enter the receipt total.'); return; }
    setSaving(true);
    const r = await addCrewReceipt({ siteId: site.id, date, category, vendor, amount: amt, note, file });
    setSaving(false);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    toastSuccess(`${fmtMoney(amt)} receipt saved`);
    onDone();
  };

  return (
    <div style={FORM_BOX}>
      <label style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: preview ? 0 : '18px 0',
        border: '2px dashed rgba(13,115,119,0.3)', borderRadius: 12, cursor: 'pointer', overflow: 'hidden',
        color: 'var(--teal)', fontWeight: 700, fontSize: 14,
      }}>
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt="Receipt" style={{ width: '100%', maxHeight: 240, objectFit: 'contain' }} />
          : file ? <><Receipt size={18} /> {file.name}</> : <><Camera size={18} /> Take or choose a photo</>}
        <input type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Total $"><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="129.50" /></Field>
        <Field label="Date"><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
      <Field label="Type">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RECEIPT_CATEGORIES.map((c) => (
            <Pill key={c.value} on={category === c.value} onClick={() => setCategory(c.value)}>{c.label}</Pill>
          ))}
        </div>
      </Field>
      <Field label="Where (optional)"><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Hampton Inn" /></Field>
      <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="2 rooms, 3 nights" /></Field>
      <div style={{ fontSize: 12, color: '#777' }}>
        Travel so far on this site: {fmtMoney(Number(site.travel_spent))} of {fmtMoney(Number(site.travel_cap))}
      </div>
      <button className="btn btn-primary" onClick={save} disabled={saving} style={{ justifyContent: 'center' }}>
        {saving ? <Loader2 size={14} className="spin" /> : <Receipt size={14} />} {saving ? 'Uploading…' : 'Save receipt'}
      </button>
    </div>
  );
}

function SiteLog({ entries, receipts, onChanged }: {
  entries: TechCrewEntry[]; receipts: TechCrewReceipt[]; onChanged: () => void;
}) {
  const removeDay = async (id: string) => {
    if (!confirm('Delete this day?')) return;
    const r = await deleteCrewTime(id);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    onChanged();
  };
  const removeReceipt = async (id: string) => {
    if (!confirm('Delete this receipt?')) return;
    const r = await deleteCrewReceipt(id);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    onChanged();
  };
  const view = async (path: string) => {
    const url = await receiptUrl(path);
    if (url) window.open(url, '_blank'); else toastError("Couldn't open that photo.");
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map((e) => (
        <Row key={e.id}
          left={`${fmtDate(e.work_date)} · ${Number(e.hours)} hrs${e.helper_present ? '' : ' · no helper'}`}
          sub={e.note}
          status={e.status}
          onDelete={e.status !== 'approved' ? () => removeDay(e.id) : undefined} />
      ))}
      {receipts.map((r) => (
        <Row key={r.id}
          left={`${fmtDate(r.receipt_date)} · ${cap(r.category)} · ${fmtMoney(Number(r.amount))}`}
          sub={r.vendor}
          status={r.status}
          onView={r.file_path ? () => view(r.file_path!) : undefined}
          onDelete={r.status === 'submitted' ? () => removeReceipt(r.id) : undefined} />
      ))}
    </div>
  );
}

// ── Pick sites ──────────────────────────────────────────────────────────────

function PickBoard({ board, onChanged }: { board: TechCrewBoard; onChanged: () => void }) {
  const weeks = useMemo(() => projectWeeks({
    start_date: board.start_date, weeks: board.weeks, skip_weeks: board.skip_weeks ?? [],
  }), [board]);
  const myTeam = board.my_team_ids[0];
  const myWeeks = new Set(board.sites.filter((s) => s.team_id === myTeam && s.week_start).map((s) => s.week_start!.slice(0, 10)));
  const openWeeks = weeks.filter((w) => !w.skipped && !myWeeks.has(w.monday) && w.monday >= mondayToday());
  const [week, setWeek] = useState(openWeeks[0]?.monday ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const open = board.sites.filter((s) => !s.team_id);
  const mine = board.sites.filter((s) => s.team_id === myTeam).sort((a, b) => (a.week_start ?? '').localeCompare(b.week_start ?? ''));
  const teamName = (id: string | null) => board.teams.find((t) => t.id === id)?.lead_name ?? '—';

  const claim = async (siteId: string) => {
    if (!week) { toastError('Pick a week first.'); return; }
    setBusy(siteId);
    const r = await claimCrewSite(siteId, week);
    setBusy(null);
    if (!r.ok) { toastError(crewReason(r.reason)); onChanged(); return; }
    toastSuccess('Site added to your schedule');
    onChanged();
  };
  const release = async (siteId: string) => {
    if (!confirm('Give this site back so another team can take it?')) return;
    setBusy(siteId);
    const r = await releaseCrewSite(siteId);
    setBusy(null);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    onChanged();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="glass card" style={{ padding: 14 }}>
        <Head>Your weeks</Head>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {weeks.map((w) => {
            const s = mine.find((x) => x.week_start?.slice(0, 10) === w.monday);
            return (
              <div key={w.monday} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', borderBottom: '1px solid #f0ede6' }}>
                <span style={{ fontWeight: 700, width: 64, flexShrink: 0, color: w.skipped ? '#bbb' : '#333' }}>{w.label}</span>
                <span style={{ flex: 1, color: w.skipped ? '#bbb' : s ? '#333' : '#aaa' }}>
                  {w.skipped ? 'Off (holiday week)' : s ? `${s.name}${s.city ? ` · ${s.city}` : ''}` : 'Open'}
                </span>
                {s && (s.status === 'scheduled' || s.status === 'planned') && (
                  <button onClick={() => release(s.id)} disabled={busy === s.id}
                    style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                    Give back
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="glass card" style={{ padding: 14 }}>
        <Head>Open sites ({open.length})</Head>
        {openWeeks.length === 0 ? (
          <Muted>Every week on your schedule is filled.</Muted>
        ) : (
          <>
            <Field label="Week to add a site to">
              <select className="select" value={week} onChange={(e) => setWeek(e.target.value)}>
                {openWeeks.map((w) => <option key={w.monday} value={w.monday}>Week of {w.label}</option>)}
              </select>
            </Field>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
              {open.length === 0 && <Muted>No open sites left.</Muted>}
              {open.map((s) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #f0ede6' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{[s.address, s.city, s.state].filter(Boolean).join(', ')}{s.property_id ? ` · #${s.property_id}` : ''}</div>
                  </div>
                  <button className="btn btn-primary" onClick={() => claim(s.id)} disabled={busy === s.id}
                    style={{ flexShrink: 0, padding: '7px 12px' }}>
                    {busy === s.id ? 'Adding…' : 'Take it'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="glass card" style={{ padding: 14 }}>
        <Head>Who has what</Head>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
          {board.sites.filter((s) => s.team_id).sort((a, b) => (a.week_start ?? '').localeCompare(b.week_start ?? '')).map((s) => (
            <div key={s.id} style={{ display: 'flex', gap: 8 }}>
              <span style={{ width: 64, flexShrink: 0, color: '#888' }}>{s.week_start ? fmtShort(s.week_start) : '—'}</span>
              <span style={{ flex: 1 }}>{s.name}</span>
              <span style={{ color: '#888' }}>{teamName(s.team_id)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Messages ────────────────────────────────────────────────────────────────

function Channel({ board }: { board: TechCrewBoard }) {
  const [msgs, setMsgs] = useState<TechCrewMessage[]>([]);
  const [to, setTo] = useState<string>('');           // '' everyone, 'office', or a lead id
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const myLeadIds = new Set(board.teams.filter((t) => board.my_team_ids.includes(t.id)).map((t) => t.lead_id));
  const otherLeads = board.teams.filter((t) => t.lead_id && !myLeadIds.has(t.lead_id));

  const load = useCallback(async () => {
    try { setMsgs(await fetchCrewMessages(board.id)); } catch { /* keep the last good list */ }
  }, [board.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);  // simple and reliable; no socket to drop
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    const r = await sendCrewMessage(board.id, to || null, body);
    setSending(false);
    if (!r.ok) { toastError(crewReason(r.reason)); return; }
    setDraft('');
    load();
  };

  return (
    <div className="glass card" style={{ padding: 14 }}>
      <Head>{board.name}</Head>
      <div style={{ maxHeight: '55vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 8px' }}>
        {msgs.length === 0 && <Muted>No messages yet. Say hello to the crew.</Muted>}
        {msgs.map((m) => (
          <div key={m.id} style={{ alignSelf: m.mine ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
            <div style={{ fontSize: 10.5, color: '#999', marginBottom: 2, textAlign: m.mine ? 'right' : 'left' }}>
              {m.mine ? 'You' : m.from_name}
              {m.to_office ? ' → Fred only' : m.to_name ? ` → ${m.to_name} only` : ' → everyone'}
              {' · '}{new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
            <div style={{
              padding: '8px 12px', borderRadius: 12, fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap',
              background: m.mine ? 'var(--teal)' : (m.to_office || m.to_id) ? 'rgba(245,158,11,0.12)' : 'rgba(13,115,119,0.08)',
              color: m.mine ? 'white' : '#333',
            }}>{m.content}</div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #eee', paddingTop: 8 }}>
        <select className="select" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">To: everyone on the project</option>
          <option value="office">To: Fred only</option>
          {otherLeads.map((t) => <option key={t.id} value={t.lead_id!}>To: {t.lead_name} only</option>)}
        </select>
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={send} disabled={sending || !draft.trim()} aria-label="Send" style={{ alignSelf: 'stretch' }}>
            <Send size={16} />
          </button>
        </div>
        <div style={{ fontSize: 11, color: '#aaa' }}>Fred can read every message on the project.</div>
      </div>
    </div>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────

const FORM_BOX: React.CSSProperties = {
  marginTop: 10, padding: 12, borderRadius: 12, background: 'rgba(13,115,119,0.04)',
  border: '1px solid rgba(13,115,119,0.12)', display: 'flex', flexDirection: 'column', gap: 10,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 13px', borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
      border: on ? '1px solid var(--teal)' : '1px solid rgba(13,115,119,0.2)',
      background: on ? 'var(--teal)' : 'white', color: on ? 'white' : 'var(--teal)',
    }}>{children}</button>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ background: warn ? 'rgba(245,158,11,0.10)' : 'rgba(13,115,119,0.05)', borderRadius: 10, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 800, color: warn ? '#b45309' : '#333', marginTop: 2 }}>{value}</div>
    </div>
  );
}

const STATUS_STYLE: Record<string, { label: string; color: string }> = {
  submitted: { label: 'Waiting on Fred', color: '#b45309' },
  approved: { label: 'Approved', color: '#047857' },
  rejected: { label: 'Rejected', color: '#b91c1c' },
  reimbursed: { label: 'Reimbursed', color: '#047857' },
};

function Row({ left, sub, status, onView, onDelete }: {
  left: string; sub?: string | null; status: string; onView?: () => void; onDelete?: () => void;
}) {
  const s = STATUS_STYLE[status] ?? { label: status, color: '#777' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid #f3f1ea' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{left}</div>
        {sub && <div style={{ color: '#999', fontSize: 11.5 }}>{sub}</div>}
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: s.color }}>{s.label}</span>
      {onView && <button onClick={onView} style={ICON_BTN} aria-label="View photo"><Receipt size={14} /></button>}
      {onDelete && <button onClick={onDelete} style={{ ...ICON_BTN, color: '#b91c1c' }} aria-label="Delete"><Trash2 size={14} /></button>}
    </div>
  );
}

const ICON_BTN: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--teal)', padding: 4, display: 'flex' };

function Head({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--teal)', textTransform: 'uppercase', marginBottom: 9 }}>{children}</div>;
}

function Muted({ children }: { children: React.ReactNode }) {
  return <div style={{ textAlign: 'center', padding: '18px 12px', color: '#999', fontSize: 13 }}>{children}</div>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function fmtShort(s: string) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function mondayToday(): string {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return ymd(d);
}
