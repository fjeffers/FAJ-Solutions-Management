'use client';
// The tech portal — WorkFlow's look and features inside the FAJ app (Fred,
// 2026-10-02: "all one app with a tech portal", "I like it, keep it").
//
// A tech signs in here and sees only their own work: jobs, offers to accept,
// the checklist, the clock, messages to the office, their pay history and
// their paperwork. Never the client price, never anyone else's job.
//
// No signal: the last copy of their lists is kept on the phone, and taps
// (clock, checklist, accept/decline, work done) wait in the outbox
// (lib/wf-outbox.ts) and go to the office, in order and with the time they were
// really made, as soon as there is signal.
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchTechProfile, fetchTechPayments, fetchTechSummary, fetchTechUnread, fetchTechDmUnread,
  fetchTechPortalToken, saveTechProfile, paymentsByYear, fetchTechMessages, sendTechMessage,
} from '@/lib/tech-portal';
import { fetchWfTechJobs, registerTechHandlers, applyPending, toChatJob } from '@/lib/tech-wf';
import {
  Outbox, browserStorage, saveCopy, loadCopy, lastUid, clearCopies, isNoSignal, makeAction, outcomeMessage,
  type PendingAction,
} from '@/lib/wf-outbox';
import {
  techCounts, matchesWf, sortWf, statusesPresent, wfStatusLabel, canWork, isClockedIn, isFinished, formatDuration,
  fullAddress, type WfJob, type WfStatus, type WfTask,
} from '@/lib/wf';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';
import Toaster from '@/components/Toaster';
import TechChat from '@/components/TechChat';
import TechInstall from '@/components/TechInstall';
import TechCrew from '@/components/TechCrew';
import { fetchCrewBoard } from '@/lib/crew-portal';
import PortalDocuments from '@/app/portal/[token]/PortalDocuments';
import { Banner, Dialog, Empty, Filters, Hero, JobCard, Section, greeting } from '@/components/wf/WfUi';
import WfJobDetail, { TimeClockCard, mapsDirections } from '@/components/wf/WfJobDetail';
import type { TechMessage, TechPayment, TechProfile, TechSummary } from '@/lib/types';
import {
  Briefcase, CheckCircle2, CloudOff, FileText, FileWarning, Inbox, LogOut, Menu, MessageSquare, Navigation,
  RefreshCw, Save, Send, ThumbsDown, ThumbsUp, User, Users, Wallet, X,
} from 'lucide-react';

type Tab = 'jobs' | 'offers' | 'crew' | 'pay' | 'chat' | 'profile' | 'paperwork';
const TABS: Tab[] = ['jobs', 'offers', 'crew', 'pay', 'chat', 'profile', 'paperwork'];
const COPIES = ['profile', 'jobs', 'payments', 'summary'];
const TAB_TITLE: Record<Tab, string> = {
  jobs: 'My jobs', offers: 'Offers', crew: 'Crew project', pay: 'Pay history',
  chat: 'Messages', profile: 'Profile', paperwork: 'W-9 & agreement',
};

export default function TechPortalPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const kv = useMemo(() => browserStorage(), []);

  const [phase, setPhase] = useState<'loading' | 'denied' | 'nodata' | 'ready'>('loading');
  const [uid, setUid] = useState<string | null>(null);
  // The installed app's "My pay" shortcut opens straight on that tab.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'jobs';
    const t = new URLSearchParams(window.location.search).get('tab');
    return t === 'open' ? 'offers' : TABS.includes(t as Tab) ? (t as Tab) : 'jobs';
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  const [profile, setProfile] = useState<TechProfile | null>(null);
  const [officeJobs, setOfficeJobs] = useState<WfJob[]>([]);
  const [payments, setPayments] = useState<TechPayment[]>([]);
  const [summary, setSummary] = useState<TechSummary | null>(null);
  const [unread, setUnread] = useState(0);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [onCrew, setOnCrew] = useState(false);
  /** When the lists on screen are the phone's saved copy, when it was saved. */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const boxRef = useRef<Outbox | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const box = boxRef.current;
  const pending = box?.pending ?? [];
  const jobs = useMemo(() => applyPending(officeJobs, pending), [officeJobs, pending]);

  const loadLive = useCallback(async (u: string, quiet: boolean) => {
    setRefreshing(true);
    try {
      const me = await fetchTechProfile();
      if (!me) {
        // Not a tech. The owner belongs in management, where WorkFlow is.
        const { data } = await supabase.rpc('wf_role');
        if ((data as { role?: string } | null)?.role === 'owner') { router.replace('/?view=workorders'); return; }
        setPhase('denied');
        return;
      }
      const [j, p, s, u1, u2, tok] = await Promise.all([
        fetchWfTechJobs(), fetchTechPayments(), fetchTechSummary(), fetchTechUnread(), fetchTechDmUnread(), fetchTechPortalToken(),
      ]);
      setProfile(me); setOfficeJobs(j); setPayments(p); setSummary(s); setUnread(u1 + u2); setPortalToken(tok);
      saveCopy(kv, u, 'profile', me);
      saveCopy(kv, u, 'jobs', j);
      saveCopy(kv, u, 'payments', p);
      saveCopy(kv, u, 'summary', s);
      setSavedAt(null);
      boxRef.current?.noteSignal(true);
      setPhase('ready');
      // A crew lookup failing must not lock a tech out of their normal jobs.
      fetchCrewBoard().then((b) => setOnCrew(b.length > 0)).catch(() => {});
    } catch (e) {
      if (isNoSignal(e)) {
        boxRef.current?.noteSignal(false);
        if (!quiet) toastInfo('No signal — showing what was saved on this phone.');
        setPhase((ph) => (ph === 'loading' ? 'nodata' : ph));
      } else {
        toastError("Couldn't load your jobs. Tap refresh to try again.");
        setPhase((ph) => (ph === 'loading' ? 'ready' : ph));
      }
    } finally {
      setRefreshing(false);
    }
  }, [kv, router, supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let u: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        u = session?.user.id ?? null;
      } catch { /* with no signal an expired sign-in cannot be refreshed */ }
      // No signal and no usable sign-in: open on the copy saved for the last
      // person who used the portal on this phone. Taps still queue, and go out
      // once the sign-in refreshes with signal.
      if (!u && typeof navigator !== 'undefined' && navigator.onLine === false) {
        const last = lastUid(kv);
        if (last && loadCopy(kv, last, 'profile')) u = last;
      }
      if (!u) { router.replace('/tech/login'); return; }
      if (cancelled) return;
      setUid(u);

      const b = new Outbox(kv, u);
      registerTechHandlers(b);
      b.subscribe(bump);
      // Taps that waited for signal went out: fetch the office's copy again.
      b.onFlushed = () => { void loadLive(u, true); };
      boxRef.current = b;

      const cp = loadCopy<TechProfile>(kv, u, 'profile');
      const cj = loadCopy<WfJob[]>(kv, u, 'jobs');
      if (cp && cj) {
        setProfile(cp.value);
        setOfficeJobs(cj.value);
        setPayments(loadCopy<TechPayment[]>(kv, u, 'payments')?.value ?? []);
        setSummary(loadCopy<TechSummary>(kv, u, 'summary')?.value ?? null);
        setSavedAt(cj.at);
        setPhase('ready');
      }
      await loadLive(u, !(cp && cj));
      if (b.pending.length > 0) void b.flush();
    })();
    return () => { cancelled = true; boxRef.current?.dispose(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Signal back: send what is waiting, and refresh.
  useEffect(() => {
    if (!uid) return;
    const back = () => { void boxRef.current?.flush(); void loadLive(uid, true); };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [uid, loadLive]);

  /** Every tap goes through here: shown at once, sent now or kept for later. */
  const act = useCallback(async (action: PendingAction, sent?: string) => {
    const b = boxRef.current;
    if (!b || !uid) return;
    setOfficeJobs((js) => applyPending(js, [action]));
    const outcome = await b.run(action);
    const msg = outcomeMessage(outcome, sent);
    if (outcome.status === 'refused') toastError(msg ?? "That didn't go through.");
    else if (outcome.status === 'queued') toastInfo(msg ?? '');
    else if (msg) toastSuccess(msg);
    if (outcome.status !== 'queued') void loadLive(uid, true);
  }, [uid, loadLive]);

  const signOut = async () => {
    const waiting = boxRef.current?.pending.length ?? 0;
    if (waiting > 0 && !confirm(`${waiting} tap${waiting === 1 ? " hasn't" : "s haven't"} reached the office yet. They stay on this phone and go out the next time you sign in. Sign out anyway?`)) return;
    if (uid) clearCopies(kv, uid, COPIES);
    await supabase.auth.signOut();
    router.replace('/tech/login');
  };

  const go = (t: Tab) => { setTab(t); setOpenId(null); setRailOpen(false); window.scrollTo({ top: 0 }); };

  const counts = techCounts(jobs);
  const offers = jobs.filter((j) => j.status === 'offered');
  const paperworkDue = (profile && !profile.w9_received ? 1 : 0) + (profile && !profile.contract_signed_at ? 1 : 0);
  const openJob = openId ? jobs.find((j) => j.id === openId) ?? null : null;

  if (phase === 'loading') {
    return (
      <div className="wf wf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw size={26} color="var(--wf-gold)" className="spin" />
          <div className="wf-h1" style={{ marginTop: 10, fontSize: 21 }}>Loading your jobs…</div>
        </div>
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="wf wf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="wf-card" style={{ maxWidth: 420, padding: 28, textAlign: 'center' }}>
          <div className="wf-h1" style={{ fontSize: 22 }}>Not a tech account</div>
          <p className="wf-subtle" style={{ margin: '8px 0 18px' }}>
            You&apos;re signed in, but this login isn&apos;t linked to a contractor record.
            If you&apos;re a tech, ask Fred to add your email to your contractor profile.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="wf-btn wf-btn-outline" href="/">Management app</a>
            <button className="wf-btn wf-btn-navy" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'nodata') {
    return (
      <div className="wf wf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Empty
          icon={<CloudOff size={34} />}
          title="No signal"
          message="Nothing is saved on this phone yet. Open the portal once with signal and your jobs will be here next time, signal or not."
          action={<button className="wf-btn wf-btn-navy" onClick={() => uid && loadLive(uid, false)}><RefreshCw size={16} /> Try again</button>}
        />
      </div>
    );
  }

  const railItem = (t: Tab, icon: React.ReactNode, badge?: number) => (
    <button className="wf-rail-item" aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
      {icon} {TAB_TITLE[t]}
      {badge != null && badge > 0 && <span className="wf-rail-badge">{badge}</span>}
    </button>
  );

  return (
    <div className="wf wf-shell">
      <Toaster />
      {railOpen && <div className="wf-drawer-backdrop" onClick={() => setRailOpen(false)} />}
      <nav className={`wf-rail${railOpen ? ' open' : ''}`} aria-label="Tech portal">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: 10 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-mark.png" alt="" width={38} height={38} style={{ flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div className="wf-display" style={{ fontSize: 11, letterSpacing: 1.4, color: 'var(--wf-gold)', fontWeight: 700 }}>FAJ SOLUTIONS</div>
            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.name}</div>
          </div>
        </div>
        {railItem('jobs', <Briefcase size={18} />)}
        {railItem('offers', <Inbox size={18} />, offers.length)}
        {onCrew && railItem('crew', <Users size={18} />)}
        {railItem('pay', <Wallet size={18} />)}
        {railItem('chat', <MessageSquare size={18} />, unread)}
        {railItem('profile', <User size={18} />)}
        {railItem('paperwork', <FileText size={18} />, paperworkDue)}
        <div style={{ flex: 1 }} />
        <button className="wf-rail-item" onClick={signOut}><LogOut size={18} /> Sign out</button>
      </nav>

      <div className="wf-main">
        <header className="wf-topbar">
          <button className="wf-btn wf-btn-ghost wf-btn-sm wf-menu-btn" onClick={() => setRailOpen(true)} aria-label="Open the menu">
            <Menu size={20} />
          </button>
          <div className="wf-title" style={{ flex: 1, fontSize: 17, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {openJob ? `WO ${openJob.number}` : TAB_TITLE[tab]}
          </div>
          <SyncStatus box={box} savedAt={savedAt} />
          <button className="wf-btn wf-btn-ghost wf-btn-sm" aria-label="Refresh" disabled={refreshing}
            onClick={() => { if (uid) { void box?.flush(); void loadLive(uid, false); } }}>
            <RefreshCw size={17} className={refreshing ? 'spin' : undefined} />
          </button>
        </header>

        <main className="wf-content">
          {box && box.problems.length > 0 && (
            <div className="wf-card" style={{ padding: 14, marginBottom: 14, borderColor: 'rgba(198,40,40,0.35)', background: 'rgba(198,40,40,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, color: 'var(--wf-danger)', flex: 1 }}>The office didn&apos;t accept {box.problems.length === 1 ? 'one tap' : `${box.problems.length} taps`} made with no signal</div>
                <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => box.clearProblems()} aria-label="Dismiss"><X size={16} /></button>
              </div>
              {box.problems.map((p) => <div key={p} style={{ fontSize: 13, marginTop: 4 }}>{p}</div>)}
            </div>
          )}

          {openJob ? (
            <TechJobScreen job={openJob} onBack={() => setOpenId(null)} act={act}
              onRefresh={() => uid && loadLive(uid, false)} refreshing={refreshing} />
          ) : tab === 'jobs' ? (
            <JobsHome
              name={profile?.name ?? ''} jobs={jobs} counts={counts} offers={offers.length} onCrew={onCrew}
              paperworkDue={paperworkDue} profile={profile}
              onOpen={(id) => { setOpenId(id); window.scrollTo({ top: 0 }); }} go={go}
            />
          ) : tab === 'offers' ? (
            <OffersList jobs={offers} onOpen={(id) => { setOpenId(id); window.scrollTo({ top: 0 }); }} act={act} />
          ) : tab === 'crew' ? (
            <TechCrew />
          ) : tab === 'pay' ? (
            <PayTab payments={payments} summary={summary} />
          ) : tab === 'chat' ? (
            <TechChat
              jobs={jobs.filter((j) => !isFinished(j) && j.status !== 'declined').map(toChatJob)}
              onRead={async () => {
                const [u1, u2] = await Promise.all([fetchTechUnread(), fetchTechDmUnread()]);
                setUnread(u1 + u2);
              }}
            />
          ) : tab === 'profile' && profile ? (
            <ProfileTab profile={profile} onSaved={(p) => { setProfile(p); if (uid) saveCopy(kv, uid, 'profile', p); }} />
          ) : tab === 'paperwork' && profile ? (
            portalToken ? (
              // The SAME component and API route the emailed portal link uses.
              // Tax IDs and bank details travel one audited path, not two.
              <PortalDocuments
                token={portalToken}
                w9Received={!!profile.w9_received}
                w9SubmittedAt={profile.w9_submitted_at}
                contractUrl={null}
                contractSignedAt={profile.contract_signed_at}
                contractSignedName={null}
                contractorName={profile.name}
              />
            ) : (
              <Empty title="Couldn't open your paperwork" message="It needs signal. Try again, or sign out and back in." />
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}

// ── The bar's signal / waiting indicator ────────────────────────────────────

function SyncStatus({ box, savedAt }: { box: Outbox | null; savedAt: string | null }) {
  if (!box) return null;
  const waiting = box.pending.length;
  if (waiting > 0) {
    return (
      <button className="wf-chip" onClick={() => void box.flush()} title="Send now"
        style={{ border: 'none', cursor: 'pointer', color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.12)', padding: '6px 11px' }}>
        <CloudOff size={14} /> {waiting} waiting · Send now
      </button>
    );
  }
  if (box.offline) {
    return (
      <span className="wf-chip" style={{ color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.12)', padding: '6px 11px' }}
        title={savedAt ? `Showing the copy saved ${new Date(savedAt).toLocaleString()}` : undefined}>
        <CloudOff size={14} /> No signal
      </span>
    );
  }
  return null;
}

// ── My jobs ─────────────────────────────────────────────────────────────────

function JobsHome({ name, jobs, counts, offers, onCrew, paperworkDue, profile, onOpen, go }: {
  name: string; jobs: WfJob[]; counts: ReturnType<typeof techCounts>; offers: number; onCrew: boolean;
  paperworkDue: number; profile: TechProfile | null; onOpen: (id: string) => void; go: (t: Tab) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<WfStatus | 'all'>('all');
  const mine = jobs.filter((j) => j.status !== 'declined' && j.status !== 'offered');
  const searched = mine.filter((j) => matchesWf(j, search));
  const shown = sortWf(searched.filter((j) => filter === 'all' || j.status === filter));
  const first = name.trim().split(/\s+/)[0] ?? '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Hero
        title={first ? `${greeting()}, ${first}` : greeting()}
        stats={[
          { value: String(counts.today), label: 'Jobs today' },
          { value: String(counts.inProgress), label: 'In progress' },
          { value: formatDuration(counts.workedTodayMs), label: 'Logged today' },
        ]}
      />
      <TechInstall />
      {offers > 0 && (
        <Banner title="Offers" subtitle={`${offers} ${offers === 1 ? 'job is' : 'jobs are'} waiting for your answer`} onClick={() => go('offers')} />
      )}
      {paperworkDue > 0 && profile && (
        <button className="wf-card wf-card-click" onClick={() => go('paperwork')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderColor: 'rgba(180,83,9,0.35)', background: 'rgba(180,83,9,0.05)' }}>
          <FileWarning size={22} color="var(--wf-warning)" />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 700, color: 'var(--wf-warning)' }}>
              {!profile.w9_received && !profile.contract_signed_at ? 'Your W-9 and agreement are outstanding'
                : !profile.w9_received ? 'Your W-9 is outstanding' : 'Your contractor agreement is unsigned'}
            </span>
            <span className="wf-subtle" style={{ fontSize: 12.5 }}>Fred can&apos;t pay you without it. Tap to finish — it takes a minute.</span>
          </span>
        </button>
      )}
      {onCrew && (
        <button className="wf-card wf-card-click" onClick={() => go('crew')} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14 }}>
          <Users size={22} color="var(--wf-navy)" />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 600 }}>Crew project</span>
            <span className="wf-subtle" style={{ fontSize: 12.5 }}>Log today&apos;s hours, add receipts, pick sites, message the crew.</span>
          </span>
        </button>
      )}

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <h2 className="wf-title" style={{ flex: 1 }}>My jobs</h2>
        <span className="wf-display" style={{ fontWeight: 600 }}>{shown.length}</span>
      </div>
      <input className="wf-input" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search WO number, client, city…" aria-label="Search your jobs" />
      <Filters<WfStatus>
        value={filter} onChange={setFilter}
        options={statusesPresent(mine).map((st) => ({ key: st, label: wfStatusLabel(st, false), count: searched.filter((j) => j.status === st).length }))}
      />
      {shown.length === 0 ? (
        <Empty
          title={mine.length === 0 ? 'No jobs yet' : 'No jobs here'}
          message={mine.length === 0 ? 'When Fred gives you a job it shows up under Offers, then here once you accept.' : 'Nothing matches this filter or search.'}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))', gap: 12 }}>
          {shown.map((j, i) => <JobCard key={j.id} job={j} index={i} onOpen={() => onOpen(j.id)} />)}
        </div>
      )}
    </div>
  );
}

// ── Offers ──────────────────────────────────────────────────────────────────

function OffersList({ jobs, onOpen, act }: {
  jobs: WfJob[]; onOpen: (id: string) => void; act: (a: PendingAction, sent?: string) => Promise<void>;
}) {
  if (jobs.length === 0) {
    return <Empty icon={<Inbox size={34} />} title="Nothing waiting on you" message="New jobs Fred sends you show up here to accept." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="wf-subtle">Fred sent you {jobs.length === 1 ? 'this job' : 'these jobs'}. Open one to see everything, or answer here.</div>
      {jobs.map((j, i) => (
        <div key={j.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <JobCard job={j} index={i} onOpen={() => onOpen(j.id)} />
          <OfferButtons job={j} act={act} />
        </div>
      ))}
    </div>
  );
}

function OfferButtons({ job, act }: { job: WfJob; act: (a: PendingAction, sent?: string) => Promise<void> }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button className="wf-btn wf-btn-outline" style={{ flex: 1 }}
        onClick={() => {
          if (!confirm(`Not interested in WO ${job.number}? It goes back to the office so Fred can give it to someone else.`)) return;
          void act(makeAction('respond', { number: job.number, accept: false }, `Decline WO ${job.number}`), 'Sent back to the office.');
        }}>
        <ThumbsDown size={16} /> Not interested
      </button>
      <button className="wf-btn wf-btn-gold" style={{ flex: 2 }}
        onClick={() => void act(makeAction('respond', { number: job.number, accept: true }, `Accept WO ${job.number}`), 'Accepted. It is in My jobs.')}>
        <ThumbsUp size={16} /> Accept
      </button>
    </div>
  );
}

// ── One job ─────────────────────────────────────────────────────────────────

function TechJobScreen({ job, onBack, act, onRefresh, refreshing }: {
  job: WfJob; onBack: () => void; act: (a: PendingAction, sent?: string) => Promise<void>;
  onRefresh: () => void; refreshing: boolean;
}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const working = canWork(job);

  const toggleClock = () => {
    const on = isClockedIn(job);
    void act(
      makeAction('clock', { number: job.number, action: on ? 'out' : 'in' }, `Clock ${on ? 'out of' : 'in on'} WO ${job.number}`),
      on ? 'Clocked out.' : 'Clocked in. The job is in progress.',
    );
  };
  const toggleTask = (t: WfTask, done: boolean) => {
    void act(makeAction('task', { number: job.number, task: t.id, done }, `${done ? 'Tick' : 'Untick'} "${t.label}" on WO ${job.number}`));
  };

  const showClock = !isFinished(job) && job.status !== 'declined' && job.status !== 'offered';
  let bottom: React.ReactNode = null;
  if (job.status === 'offered') bottom = <OfferButtons job={job} act={act} />;
  else if (working) {
    bottom = (
      <button className="wf-btn wf-btn-navy" style={{ width: '100%' }} onClick={() => setDoneOpen(true)}>
        <CheckCircle2 size={18} /> Work done
      </button>
    );
  } else if (job.status === 'workDone') {
    bottom = (
      <div className="wf-card" style={{ padding: 12, textAlign: 'center', color: 'var(--wf-success)', fontWeight: 600 }}>
        Sent to Fred — the office takes it from here.
      </div>
    );
  }

  return (
    <>
      <WfJobDetail
        job={job}
        ownerView={false}
        onBack={onBack}
        onRefresh={onRefresh}
        refreshing={refreshing}
        actions={<>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setChatOpen((v) => !v)} aria-pressed={chatOpen}>
            <MessageSquare size={15} /> Messages
          </button>
          {fullAddress(job) && (
            <a className="wf-btn wf-btn-outline wf-btn-sm" href={mapsDirections(job)} target="_blank" rel="noopener noreferrer"><Navigation size={15} /> Directions</a>
          )}
        </>}
        clock={showClock ? <TimeClockCard job={job} enabled={working || isClockedIn(job)} onToggle={toggleClock} /> : undefined}
        onToggleTask={working ? toggleTask : undefined}
        below={chatOpen ? <JobMessages number={job.number} /> : undefined}
        bottom={bottom}
      />
      {doneOpen && (
        <WorkDoneDialog
          job={job}
          onClose={() => setDoneOpen(false)}
          onConfirm={(notes) => {
            setDoneOpen(false);
            void act(
              makeAction('workdone', { number: job.number, notes, clockOut: isClockedIn(job) }, `Work done on WO ${job.number}`),
              'Work done. The office has it.',
            );
          }}
        />
      )}
    </>
  );
}

function WorkDoneDialog({ job, onClose, onConfirm }: { job: WfJob; onClose: () => void; onConfirm: (notes: string) => void }) {
  const [notes, setNotes] = useState(job.closeoutNotes);
  return (
    <Dialog
      title="Mark the work done?"
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" onClick={() => onConfirm(notes)}><CheckCircle2 size={16} /> Work done</button>
      </>}
    >
      <p style={{ marginTop: 0 }}>
        {isClockedIn(job) ? 'You will be clocked out, and the office is told the job is finished.' : 'The office is told the job is finished.'}
      </p>
      <label className="wf-label" htmlFor="wf-done-notes" style={{ display: 'block', marginBottom: 4 }}>What was done (optional)</label>
      <textarea id="wf-done-notes" className="wf-input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
        placeholder="Work completed, anything left, anything the client said" />
    </Dialog>
  );
}

/** The job's thread with the office — the same one Fred sees on the job in WorkFlow. */
function JobMessages({ number }: { number: string }) {
  const [messages, setMessages] = useState<TechMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setMessages(await fetchTechMessages(number)); setFailed(false); }
    catch { setFailed(true); }
  }, [number]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      if (await sendTechMessage(number, body)) { setDraft(''); await load(); }
      else toastError("Couldn't send that message.");
    } catch (e) {
      toastError(isNoSignal(e) ? 'No signal — messages need signal to send. Your text is still in the box.' : "Couldn't send that message.");
    }
    setSending(false);
  };

  return (
    <Section title="Messages" subtitle="With the office, about this job">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto', marginBottom: 10 }}>
        {failed ? <div className="wf-subtle">Messages need signal. Try again when you have it.</div>
          : messages === null ? <div className="wf-subtle">Loading…</div>
          : messages.length === 0 ? <div className="wf-subtle">No messages yet. Ask the office anything about this job.</div>
          : messages.map((m) => {
            const mine = m.sender_role === 'contractor';
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '84%', padding: '9px 13px', borderRadius: 14,
                  background: mine ? 'var(--wf-navy)' : '#F1EEE6', color: mine ? '#fff' : 'var(--wf-text)',
                }}>
                  {!mine && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--wf-gold-dark)' }}>{m.sender_name}</div>}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  <div style={{ fontSize: 10.5, opacity: 0.65, marginTop: 3, textAlign: 'right' }}>
                    {new Date(m.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
        <div ref={bottom} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea className="wf-input" rows={2} value={draft} placeholder="Message the office…" style={{ flex: 1, resize: 'none' }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="wf-btn wf-btn-navy" onClick={send} disabled={sending || !draft.trim()} aria-label="Send"><Send size={17} /></button>
      </div>
    </Section>
  );
}

// ── Pay history (their own pay only — never on a job) ──────────────────────

function PayTab({ payments, summary }: { payments: TechPayment[]; summary: TechSummary | null }) {
  const years = useMemo(() => paymentsByYear(payments), [payments]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div className="wf-card" style={{ padding: 14 }}>
            <div className="wf-label">Paid this year</div>
            <div className="wf-display" style={{ fontSize: 22, fontWeight: 700, color: 'var(--wf-success)' }}>{fmtMoney(summary.paid_this_year)}</div>
          </div>
          <div className="wf-card" style={{ padding: 14 }}>
            <div className="wf-label">Paid all time</div>
            <div className="wf-display" style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(summary.paid_all_time)}</div>
          </div>
          <div className="wf-card" style={{ padding: 14 }}>
            <div className="wf-label">Jobs worked</div>
            <div className="wf-display" style={{ fontSize: 22, fontWeight: 700 }}>{summary.jobs_total}</div>
          </div>
        </div>
      )}
      {payments.length === 0 ? <Empty icon={<Wallet size={34} />} title="No payments recorded yet" /> : years.map((y) => (
        <div key={y.year}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <h3 className="wf-title" style={{ fontSize: 17 }}>{y.year}</h3>
            <div className="wf-display" style={{ fontWeight: 700, color: 'var(--wf-success)' }}>{fmtMoney(y.total)}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {y.payments.map((p) => (
              <div key={p.id} className="wf-card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.wo_title || p.wo_site || (p.wo_number ? `WO ${p.wo_number}` : 'Payment')}</div>
                  <div className="wf-subtle" style={{ fontSize: 12.5 }}>
                    {[p.payment_date && fmtDate(p.payment_date), p.wo_number && `WO ${p.wo_number}`, p.method].filter(Boolean).join(' · ')}
                  </div>
                  {p.notes && <div className="wf-subtle" style={{ fontSize: 12 }}>{p.notes}</div>}
                </div>
                <div className="wf-display" style={{ fontSize: 17, fontWeight: 700, color: 'var(--wf-success)' }}>{fmtMoney(p.amount)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

function ProfileTab({ profile, onSaved }: { profile: TechProfile; onSaved: (p: TechProfile) => void }) {
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [address, setAddress] = useState(profile.address ?? '');
  const [city, setCity] = useState(profile.city ?? '');
  const [state, setState] = useState(profile.state ?? '');
  const [zip, setZip] = useState(profile.zip ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await saveTechProfile({ phone, address, city, state, zip });
      onSaved({ ...profile, phone, address, city, state, zip });
      toastSuccess('Saved. The office has your new details.');
    } catch (e) {
      toastError(isNoSignal(e) ? 'No signal — try saving again when you have it.' : "Couldn't save your details.");
    }
    setSaving(false);
  };

  const field = (label: string, value: string, set: (v: string) => void, mode?: 'tel' | 'numeric') => (
    <label style={{ display: 'block' }}>
      <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <input className="wf-input" value={value} onChange={(e) => set(e.target.value)} inputMode={mode} />
    </label>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }}>
      <Section title="Your details">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div><div className="wf-label">Name</div><div style={{ fontWeight: 600 }}>{profile.name}</div></div>
          <div><div className="wf-label">Email</div><div style={{ fontWeight: 600 }}>{profile.email ?? '—'}</div></div>
          {profile.business_name && <div><div className="wf-label">Business</div><div style={{ fontWeight: 600 }}>{profile.business_name}</div></div>}
          {field('Phone', phone, setPhone, 'tel')}
          {field('Street address', address, setAddress)}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
            {field('City', city, setCity)}
            {field('State', state, setState)}
            {field('ZIP', zip, setZip, 'numeric')}
          </div>
          <button className="wf-btn wf-btn-navy" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save details'}</button>
        </div>
      </Section>
      <Section title="Paperwork">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Check ok={!!profile.w9_received} label="W-9 on file" detail={profile.w9_submitted_at ? `Submitted ${fmtDate(profile.w9_submitted_at)}` : 'Not received yet'} />
          <Check ok={!!profile.contract_signed_at} label="Contractor agreement" detail={profile.contract_signed_at ? `Signed ${fmtDate(profile.contract_signed_at)}` : 'Not signed yet'} />
        </div>
        <div className="wf-subtle" style={{ fontSize: 12, marginTop: 12 }}>
          Your W-9 has your Social Security or tax number, so it is filed through the secure W-9 page — never kept on this phone.
          You are paid by direct deposit through QuickBooks, which collects your bank details itself.
        </div>
      </Section>
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <CheckCircle2 size={20} color={ok ? 'var(--wf-success)' : '#C9C4B8'} />
      <div>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div className="wf-subtle" style={{ fontSize: 12 }}>{detail}</div>
      </div>
    </div>
  );
}
