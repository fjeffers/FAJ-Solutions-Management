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
  fetchTechProfile, fetchTechUnread, fetchTechDmUnread,
  fetchTechPortalToken, saveTechProfile, saveTechEmergency, fetchTechMessages, sendTechMessage, claimTechAccount,
} from '@/lib/tech-portal';
import { fetchWfTechJobs, fetchCloseoutLists, fetchTechFilesStamp, registerTechHandlers, applyPending, toChatJob } from '@/lib/tech-wf';
import { jobChanges } from '@/lib/tech-live';
import {
  Outbox, browserStorage, saveCopy, loadCopy, lastUid, clearCopies, isNoSignal, makeAction, outcomeMessage,
  type PendingAction,
} from '@/lib/wf-outbox';
import {
  techCounts, matchesWf, sortWf, sortTechJobs, canWork, isClockedIn, isFinished, formatDuration, whenText,
  fullAddress, reportMissing, askedOnly, askedDeliverables, workTypeFor, requestWhen, WF_WORK_TYPE_LABEL, TECH_FILTERS, techFilterOf, fmtClock12, parseClockTime,
  type TechFilter, type WfJob, type WfQuestion, type WfTask, type WfWorkType,
} from '@/lib/wf';
import { closeoutArgs, closeoutMissing, listFor, type CloseoutList, type CloseoutOp } from '@/lib/closeout';
import CloseoutCard from '@/components/wf/Closeout';
import ProjectDayCard, { OffSiteDialog, type DayActions } from '@/components/wf/ProjectDay';
import { PhotoLabelDialog, photoLabelChoices } from '@/components/wf/PhotoLabel';
import { LeftSiteDialog, SheetLinkButton, SiteAccessBar, buzz, openIssue, sendSiteMessage, useLateMarks, useLeftSite, useSiteTalk } from '@/components/wf/SiteTalk';
import { FsDayLog, FsStageAction } from '@/components/wf/FsWork';
import { FS_STAGE_NAME, fsStage, type FsStage } from '@/lib/fs-stage';
import { addNotes, clearNotes, loadNotes, markRead, messageNote, notesFromChanges, saveNotes, type TechNote } from '@/lib/tech-inbox';
import { FsBell } from '@/components/wf/FsBell';
import { PushSwitch } from '@/components/wf/PushSwitch';
import { dayState, lastPlace, onTheWay, tripLeg } from '@/lib/project-day';
import { asks, type CaptureItem } from '@/lib/capture';
import OdometerDialog, { readPhoto, type OdometerMoment, type SavePhoto } from '@/components/wf/Odometer';
import CheckInDialog, { type CheckInSend } from '@/components/wf/CheckIn';
import { needsOdometer, stopReceipt, type Drive } from '@/lib/checkin';
import type { ReceiptRead } from '@/lib/photo-read';
import { fmtMoney, fmtDate, todayISO } from '@/lib/utils';
import TechSchedule from '@/components/wf/TechSchedule';
import { usernameProblem, USERNAME_RULE } from '@/lib/usernames';
import { getPosition, stampLines, mapLink, milesBetween, NEED_GPS, type Position } from '@/lib/geo';
import { stampPhoto, shrinkPhoto } from '@/lib/photo-stamp';
import { EXPENSE_STATUS, expenseCategoryLabel, parseExpenseAmount, type ExpenseCategory, type ExpenseStatus } from '@/lib/expenses';
import { useExpenseCategories } from '@/lib/use-expense-categories';
import { queuePhoto, queuedPhotos, dropQueuedPhoto, type QueuedPhoto } from '@/lib/photo-queue';
import { toastError, toastInfo, toastSuccess } from '@/lib/toast';
import Toaster from '@/components/Toaster';
import TechChat from '@/components/TechChat';
import TechInstall from '@/components/TechInstall';
import PortalDocuments from '@/app/portal/[token]/PortalDocuments';
import { Banner, Dialog, Empty, Filters, Hero, JobCard, Section, TimeRequestLine, greeting } from '@/components/wf/WfUi';
import { FsBrand, FsChip, FsIcon, FsPageHeader, fsInitials } from '@/components/wf/FsUi';
import { linkLabel } from '@/lib/client-links';
import { checkoutFormUrl, clock24, lastOffOrNow, onSiteSince, parseSiteLinks, siteIdOf, type SiteLinks } from '@/lib/site-links';
import WfJobDetail, { ChecklistCard, DetailHeader, InfoListCard, SiteInfoCard, TimeClockCard } from '@/components/wf/WfJobDetail';
import SignaturePad from '@/components/wf/SignaturePad';
import DirectionsButton from '@/components/wf/Directions';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import type { TechMessage, TechProfile } from '@/lib/types';
import {
  CalendarClock, CalendarDays, Camera, MapPin, CheckCircle2, NotebookPen, PlayCircle, Receipt, StopCircle, CloudOff, FileText, FileWarning, ImagePlus, Inbox, LogOut, MessageSquare, Navigation,
  RefreshCw, Save, Search, Send, ThumbsDown, ThumbsUp, X, ScanLine, Hash, Ruler, ScanBarcode, Signature, Wrench, ChevronDown,
} from 'lucide-react';
import DocScanner from '@/components/tools/DocScanner';
import PhotoMarkup from '@/components/tools/PhotoMarkup';
import PdfEditor from '@/components/tools/PdfEditor';
import DocViewer, { docKind } from '@/components/tools/DocViewer';
import ReadTool from '@/components/tools/ReadTool';
import { DOC_KINDS, sendTechDoc, signedName } from '@/lib/job-docs';

// Primio's tech tabs — Jobs, Available, Profile (with the W-9 inside) — plus
// My schedule, Messages and Pay history (Fred, 2026-10-04: "the tech portal is
// whatever Primio has", keeping those three).
// Projects sits under My jobs in the menu (Fred, 2026-10-13: "my jobs, and
// right under my jobs ... projects"); it is not one of the bottom tabs.
// Since 2026-10-17 the portal is Field Service's tech app (Fred: "add Field
// Service's tech portal to FAJ Tech Portal", then "replace the tech portal"):
// four tabs — Project, Messenger, My Schedule, Profile. My jobs and Available
// jobs open from Profile. No pay anywhere in the tech app (Fred, 2026-10-22:
// "techs shouldn't see money for pay anywhere"): Pay history is gone.
type Tab = 'project' | 'jobs' | 'projects' | 'available' | 'schedule' | 'chat' | 'profile';
const TABS: Tab[] = ['project', 'chat', 'schedule', 'profile'];
const UNDER_PROFILE: Tab[] = ['jobs', 'available'];
// Projects is hidden in the tech app for now (Fred, 2026-10-14: "hide project
// for now on the tech portal"). While it is off, project sites are ordinary
// jobs here: listed under My jobs, with the normal clock. Set to true to bring
// back the Projects list and the travel / lunch / day-report flow.
const SHOW_PROJECTS = false;
// The job opens as Field Service's work order (Fred, 2026-10-18): the next
// step, then tabs for Overview, Documents, Photos & questions, Time & travel,
// Expenses and Messages. Set to false to bring back the one-page job screen.
const FS_JOB_SCREEN = true;
const ALL_TABS: Tab[] = SHOW_PROJECTS ? [...TABS, ...UNDER_PROFILE, 'projects'] : [...TABS, ...UNDER_PROFILE];
const COPIES = ['profile', 'jobs', 'lists'];
// Pay copies an older version saved on the phone: deleted on open.
const OLD_PAY_COPIES = ['payments', 'summary'];
/** This device's layout: 'wide' or phone (the default). */
const VIEW_KEY = 'fs-view';
const TAB_TITLE: Record<Tab, string> = {
  project: 'Work orders', jobs: 'My jobs', projects: 'Projects', available: 'Available jobs', schedule: 'My Schedule', chat: 'Messenger', profile: 'Profile',
};

export default function TechPortalPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const kv = useMemo(() => browserStorage(), []);

  const [phase, setPhase] = useState<'loading' | 'denied' | 'nodata' | 'ready'>('loading');
  const [deniedAs, setDeniedAs] = useState<'owner' | 'other'>('other');
  const [uid, setUid] = useState<string | null>(null);
  // The installed app's "My pay" shortcut opens straight on that tab.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'project';
    const t = new URLSearchParams(window.location.search).get('tab');
    // Old links still land in the right place.
    if (t === 'open' || t === 'offers') return 'available';
    if (t === 'paperwork') return 'profile';
    return ALL_TABS.includes(t as Tab) ? (t as Tab) : 'project';
  });
  // A new-job pop-up opens /tech?wo=<id> straight on that job (lib/tech-push.ts).
  const [openId, setOpenId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('wo'));

  const [profile, setProfile] = useState<TechProfile | null>(null);
  const [officeJobs, setOfficeJobs] = useState<WfJob[]>([]);
  const [unread, setUnread] = useState(0);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [lists, setLists] = useState<CloseoutList[]>([]);
  /** When the lists on screen are the phone's saved copy, when it was saved. */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const boxRef = useRef<Outbox | null>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // The bell (lib/tech-inbox.ts): what the app notices while it's open, kept on the phone.
  const [notes, setNotes] = useState<TechNote[]>([]);
  useEffect(() => { if (uid) setNotes(loadNotes(kv, uid)); }, [kv, uid]);
  const changeNotes = useCallback((f: (list: TechNote[]) => TechNote[]) => {
    setNotes((list) => {
      const next = f(list);
      if (uid) saveNotes(kv, uid, next);
      return next;
    });
  }, [kv, uid]);

  // A new message alerts them anywhere in the app, not only on that job
  // (Fred, 2026-10-14: "needs to alert them, not just come through").
  const lastUnread = useRef<number | null>(null);
  useEffect(() => {
    if (!uid) return;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const [u1, u2] = await Promise.all([fetchTechUnread(), fetchTechDmUnread()]);
        const n = u1 + u2;
        if (lastUnread.current !== null && n > lastUnread.current) {
          buzz();
          toastInfo(n - lastUnread.current === 1 ? 'New message. Open the job or Messages to read it.' : `${n - lastUnread.current} new messages.`);
          const more = n - lastUnread.current;
          changeNotes((list) => addNotes(list, [messageNote(more, new Date().toISOString())]));
        }
        lastUnread.current = n;
        setUnread(n);
      } catch { /* no signal: try again shortly */ }
    };
    void check();
    const t = window.setInterval(() => { void check(); }, 20_000);
    return () => window.clearInterval(t);
  }, [uid, changeNotes]);
  // Live updates (Fred, 2026-10-14: "implement live update between admin and
  // tech portal"): while the app is open, re-read the jobs every 30 seconds
  // and whenever the tech comes back to it, and say what changed: a new
  // time, date, address, scope, document or job.
  const liveJobs = useRef<WfJob[] | null>(null);
  const liveFiles = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!uid || phase !== 'ready') return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const [j, files] = await Promise.all([fetchWfTechJobs(), fetchTechFilesStamp()]);
        const prevJobs = liveJobs.current;
        const prevFiles = liveFiles.current;
        liveJobs.current = j;
        liveFiles.current = files;
        if (!prevJobs || !prevFiles) return;
        const changes = jobChanges(prevJobs, j, prevFiles, files);
        if (changes.length > 0) {
          buzz();
          changeNotes((list) => addNotes(list, notesFromChanges(changes, new Date().toISOString())));
          for (const c of changes.slice(0, 3)) toastInfo(c.text);
          if (changes.length > 3) toastInfo(`${changes.length - 3} more updates on your jobs.`);
        }
        for (const n of Object.keys(files)) {
          if (files[n] !== prevFiles[n]) window.dispatchEvent(new CustomEvent('wf-job-files', { detail: n }));
        }
        if (JSON.stringify(prevJobs) !== JSON.stringify(j)) {
          setOfficeJobs(j);
          saveCopy(kv, uid, 'jobs', j);
        }
      } catch { /* no signal: try again shortly */ } finally { busy = false; }
    };
    void check();
    const t = window.setInterval(() => { void check(); }, 30_000);
    const back = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', back);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [uid, phase, kv]);
  const box = boxRef.current;
  const pending = box?.pending ?? [];
  const jobs = useMemo(() => {
    const all = applyPending(officeJobs, pending);
    return SHOW_PROJECTS ? all : all.map((j) => (j.isProject ? { ...j, isProject: false } : j));
  }, [officeJobs, pending]);

  const loadLive = useCallback(async (u: string, quiet: boolean) => {
    setRefreshing(true);
    try {
      let me = await fetchTechProfile();
      if (!me) {
        // A tech arriving straight from their confirmation email has never
        // been through the sign-in page, so link the login to their tech
        // record by email here (safe to repeat; it only matches a confirmed
        // email on Fred's contractor list).
        const claim = await claimTechAccount();
        if (claim.ok) me = await fetchTechProfile();
      }
      if (!me) {
        // Not a tech. The tech portal and the admin app stay separate: say
        // which login this is, never carry it into admin.
        const { data } = await supabase.rpc('wf_role');
        setDeniedAs((data as { role?: string } | null)?.role === 'owner' ? 'owner' : 'other');
        setPhase('denied');
        return;
      }
      const [j, u1, u2, tok] = await Promise.all([
        fetchWfTechJobs(), fetchTechUnread(), fetchTechDmUnread(), fetchTechPortalToken(),
      ]);
      setProfile(me); setOfficeJobs(j); setUnread(u1 + u2); setPortalToken(tok);
      saveCopy(kv, u, 'profile', me);
      saveCopy(kv, u, 'jobs', j);
      setSavedAt(null);
      boxRef.current?.noteSignal(true);
      setPhase('ready');
      // The office's closeout checklists; a miss keeps the saved copy (or Primio's built-in lists).
      fetchCloseoutLists().then((l) => { setLists(l); saveCopy(kv, u, 'lists', l); }).catch(() => {});
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

      clearCopies(kv, u, OLD_PAY_COPIES);
      const cp = loadCopy<TechProfile>(kv, u, 'profile');
      const cj = loadCopy<WfJob[]>(kv, u, 'jobs');
      if (cp && cj) {
        setProfile(cp.value);
        setOfficeJobs(cj.value);
        setLists(loadCopy<CloseoutList[]>(kv, u, 'lists')?.value ?? []);
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
    if (waiting > 0 && !confirm(`${waiting} tap${waiting === 1 ? " hasn't" : "s haven't"} been sent yet. They stay on this phone and go out the next time you sign in. Log out anyway?`)) return;
    if (uid) { clearCopies(kv, uid, COPIES); clearNotes(kv, uid); }
    await supabase.auth.signOut();
    router.replace('/tech/login');
  };

  // Check in and the ending mileage, from the first screen, the job, or the bar at the top
  // (Fred, 2026-10-18: "when they log in it should ask"; "once they get home or hotel there
  // should be a sign out button somewhere on the top of the app").
  const [checkIn, setCheckIn] = useState<WfJob | null>(null);
  const [odoEnd, setOdoEnd] = useState<WfJob | null>(null);
  // At a fuel or materials stop: the receipt, after the ending mileage (Fred, 2026-10-21).
  const [stopFor, setStopFor] = useState<{ job: WfJob; category: ExpenseCategory } | null>(null);
  const [dayBusy, setDayBusy] = useState(false);
  // On site: the client's link for the day, e.g. their Teams meeting (migration 133).
  const [onSiteLink, setOnSiteLink] = useState<WfJob | null>(null);
  // Built when tapped, not while drawing the screen.
  const dayFor = (job: WfJob) => techDay(job, act, uid ?? '', setDayBusy, () => setOnSiteLink(job));
  const keepFor = (job: WfJob): SavePhoto => (...a) => dayFor(job).keep(...a);
  const sendFor = (job: WfJob): CheckInSend => ({
    startDrive: (d, startDay) => dayFor(job).send.startDrive(d, startDay),
    arriveOnSite: () => dayFor(job).send.arriveOnSite(),
    keep: keepFor(job),
    note: (text) => dayFor(job).send.note(text),
  });
  /** Arrive at the end of a drive: on site (the time on site starts) or at the hotel or home (signed out for the day). */
  // One arrival at a time: a second tap while the first is still saving does nothing.
  const arriving = useRef(false);
  const arriveFrom = async (job: WfJob) => {
    if (arriving.current) return;
    arriving.current = true;
    try {
      const st = dayState(job.myDay ?? []);
      const saved = await dayFor(job).arrive();
      if (!saved || st.stage !== 'travel') return;
      // The ending mileage, required at the end of every drive (lib/checkin.ts needsOdometer),
      // then the receipt at a fuel or materials stop (stopReceipt).
      if (asks(job.capture, 'travel') && needsOdometer(st.dest)) setOdoEnd(job);
      const receipt = stopReceipt(st.dest);
      if (receipt) setStopFor({ job, category: receipt });
    } finally {
      arriving.current = false;
    }
  };
  // On the way to the hotel or home: the Sign out bar at the top.
  const homeward = jobs.find((j) => j.dayFlow && (canWork(j) || j.status === 'workDone')
    && (() => { const st = dayState(j.myDay ?? []); return st.stage === 'travel' && (st.dest === 'hotel' || st.dest === 'home'); })()) ?? null;

  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // Phone view unless this device chose Wide view (Profile > Screen).
  const [wide, setWideState] = useState(() => {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(VIEW_KEY) === 'wide'; } catch { return false; }
  });
  const setWide = (w: boolean) => {
    setWideState(w);
    setDrawer(false);
    try { window.localStorage.setItem(VIEW_KEY, w ? 'wide' : 'phone'); } catch { /* private window: this visit only */ }
  };
  const go = (t: Tab) => { setTab(t); setOpenId(null); setDrawer(false); window.scrollTo({ top: 0 }); };

  const counts = techCounts(jobs);
  const offers = jobs.filter((j) => j.status === 'offered');
  const projectJobs = jobs.filter((j) => j.isProject && j.status !== 'offered' && j.status !== 'declined');
  const paperworkDue = (profile && !profile.w9_received ? 1 : 0) + (profile && !profile.contract_signed_at ? 1 : 0);
  const openJob = openId ? jobs.find((j) => j.id === openId) ?? null : null;

  if (phase === 'loading') {
    return (
      <div className="wf wf-page fs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <RefreshCw size={26} color="var(--wf-gold)" className="spin" />
          <div className="wf-h1" style={{ marginTop: 10, fontSize: 21 }}>Loading your jobs…</div>
        </div>
      </div>
    );
  }

  if (phase === 'denied') {
    return (
      <div className="wf wf-page fs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div className="wf-card" style={{ maxWidth: 420, padding: 28, textAlign: 'center' }}>
          {/* Fred, 2026-10-06: the tech side says nothing about any other login. */}
          {deniedAs === 'owner' ? (
            <>
              <div className="wf-h1" style={{ fontSize: 22 }}>Not a tech account</div>
              <p className="wf-subtle" style={{ margin: '8px 0 18px' }}>
                This login isn&apos;t a tech account. Sign out, then sign in with your tech username or email.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="wf-btn wf-btn-navy" onClick={signOut}>Sign out</button>
              </div>
            </>
          ) : (
            <>
              <div className="wf-h1" style={{ fontSize: 22 }}>Not a tech account</div>
              <p className="wf-subtle" style={{ margin: '8px 0 18px' }}>
                You&apos;re signed in, but this login&apos;s email isn&apos;t on any tech record.
                If you&apos;re a tech, ask FAJ Solutions to put this email on your tech record, then sign in again.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                <button className="wf-btn wf-btn-navy" onClick={signOut}>Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'nodata') {
    return (
      <div className="wf wf-page fs" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Empty
          icon={<CloudOff size={34} />}
          title="No signal"
          message="Nothing is saved on this phone yet. Open the portal once with signal and your jobs will be here next time, signal or not."
          action={<button className="wf-btn wf-btn-navy" onClick={() => uid && loadLive(uid, false)}><RefreshCw size={16} /> Try again</button>}
        />
      </div>
    );
  }

  // Paperwork first (Fred, 2026-10-02: "reinforce the W-9 at log in for tech
  // and the contract"). Until a tech has signed the contractor agreement AND
  // filed a W-9, the portal shows only that — no jobs, offers or pay. Filing
  // either form reloads the profile, and the portal opens once both are in.
  if (profile && (!profile.w9_received || !profile.contract_signed_at)) {
    return (
      <PaperworkGate
        profile={profile}
        portalToken={portalToken}
        onFiled={() => { if (uid) void loadLive(uid, true); }}
        onRetry={() => { if (uid) void loadLive(uid, false); }}
        onSignOut={signOut}
      />
    );
  }

  const underProfile = UNDER_PROFILE.includes(tab);
  const openFromList = (id: string) => { setOpenId(id); window.scrollTo({ top: 0 }); };
  const waiting = pending.length;
  const small = collapsed && !drawer;
  const navItems: { key: Tab; label: string; icon: string; count: number }[] = [
    { key: 'project', label: 'Work orders', icon: 'clipboard', count: jobs.filter(canWork).length },
    { key: 'chat', label: 'Messenger', icon: 'chat', count: unread },
    { key: 'schedule', label: 'My Schedule', icon: 'calendar', count: 0 },
    { key: 'profile', label: 'Profile', icon: 'person', count: offers.length + paperworkDue },
  ];
  const navKey: Tab = underProfile ? 'profile' : tab;
  const toggleMenu = () => {
    if (!wide || window.matchMedia('(max-width: 900px)').matches) setDrawer((v) => !v);
    else setCollapsed((v) => !v);
  };

  return (
    <div className={`wf fs fs-app${wide ? '' : ' fs-phone'}`}>
      <Toaster />
      <header className="fs-topbar">
        <FsBrand />
        <button type="button" className={`fs-menu-button${collapsed || drawer ? ' pressed' : ''}`} onClick={toggleMenu}
          aria-label="Menu" aria-expanded={drawer || !collapsed}>
          <FsIcon name="menu" size={20} /><span>Menu</span>
        </button>
        <nav className="fs-crumbs" aria-label="Breadcrumb">
          <span>Workspace</span><FsIcon name="arrow" size={13} /><b>{openJob ? `WO ${openJob.number}` : TAB_TITLE[tab]}</b>
        </nav>
        {waiting > 0 || box?.offline
          ? <span style={{ marginLeft: 'auto' }}><SyncStatus box={box} savedAt={savedAt} /></span>
          : <span className="fs-live-pill"><i />Live workspace</span>}
        <FsBell notes={notes}
          onReadAll={() => changeNotes((list) => markRead(list))}
          onOpen={(n) => {
            changeNotes((list) => markRead(list, [n.id]));
            const j = n.number ? jobs.find((x) => x.number === n.number) : null;
            if (j) { setTab('project'); openFromList(j.id); } else if (n.kind === 'message') go('chat');
          }} />
        <button type="button" className="fs-icon-button fs-refresh" aria-label="Refresh" disabled={refreshing}
          onClick={() => { if (uid) { void box?.flush(); void loadLive(uid, false); } }}>
          <FsIcon name="refresh" size={18} className={refreshing ? 'spin' : undefined} />
        </button>
        <div className="fs-who">
          <span className="fs-avatar" aria-hidden="true">{fsInitials(profile?.name)}</span>
          <span><b>{profile?.name}</b><small>Technician</small></span>
        </div>
        <button type="button" className="fs-signout" onClick={signOut} aria-label="Log out">
          <FsIcon name="logout" size={18} /><span>Log out</span>
        </button>
      </header>
      {homeward && <DayStrip job={homeward} busy={dayBusy} onSignOut={() => void arriveFrom(homeward)} />}

      {checkIn && (() => {
        const st = fsStage(checkIn.myDay ?? [], {}, undefined, 'America/New_York');
        return (
          <CheckInDialog job={checkIn} startOfDay={st === 'ready' || st === 'done'} afterWork={checkIn.status === 'workDone'}
            from={lastPlace(checkIn.myDay ?? [])} send={sendFor(checkIn)} onClose={() => setCheckIn(null)} />
        );
      })()}
      {odoEnd && <OdometerDialog woNumber={odoEnd.number} moment="end" required keep={keepFor(odoEnd)} onClose={() => setOdoEnd(null)} />}
      {stopFor && !odoEnd && <ExpenseDialog job={stopFor.job} initialCategory={stopFor.category} onClose={() => setStopFor(null)} onSaved={() => setStopFor(null)} />}
      {/* After the ending mileage and Check in's own steps, so one window at a time. */}
      {onSiteLink && !odoEnd && !checkIn && <OnSiteLinkDialog number={onSiteLink.number} onClose={() => setOnSiteLink(null)} />}
      <div className={`fs-layout${collapsed ? ' collapsed' : ''}${drawer ? ' drawer-open' : ''}`}>
        <aside className={`fs-sidebar${small ? ' collapsed' : ''}`} aria-label="Workspace">
          <button type="button" className="fs-side-close" onClick={() => setDrawer(false)}>Close menu <FsIcon name="close" size={16} /></button>
          {!small && <p className="fs-side-label">YOUR WORKSPACE</p>}
          <nav className="fs-side-nav" aria-label="Main">
            {navItems.map((it) => (
              <button type="button" key={it.key} className={navKey === it.key ? 'active' : ''}
                aria-current={navKey === it.key ? 'page' : undefined} aria-label={small ? it.label : undefined}
                title={small ? it.label : undefined} onClick={() => go(it.key)}>
                <FsIcon name={it.icon} size={20} />
                {!small && <span>{it.label}</span>}
                {!small && it.count > 0 && <em>{it.count}</em>}
              </button>
            ))}
          </nav>
          {!small && (
            <div className="fs-side-foot">
              <div className="fs-side-card"><FsIcon name="pin" size={22} /><b>Wherever work takes you.</b><p>Keep your team and your sites moving together.</p></div>
              <p className={`fs-side-status${waiting ? ' off' : ''}`}><i />{waiting ? 'Saved on this phone' : 'Workspace connected'}</p>
              <p className="fs-side-mark">FAJ SOLUTIONS <b>TECH PORTAL</b></p>
            </div>
          )}
        </aside>
        {drawer && <button type="button" className="fs-scrim" aria-label="Close menu" onClick={() => setDrawer(false)} />}

        <main className="fs-content" id="main">
          {box && box.problems.length > 0 && (
            <div className="wf-card" style={{ padding: 14, marginBottom: 14, borderColor: 'rgba(198,40,40,0.35)', background: 'rgba(198,40,40,0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontWeight: 700, color: 'var(--wf-danger)', flex: 1 }}>FAJ couldn&apos;t accept {box.problems.length === 1 ? 'one tap' : `${box.problems.length} taps`} made with no signal</div>
                <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={() => box.clearProblems()} aria-label="Dismiss"><X size={16} /></button>
              </div>
              {box.problems.map((p) => <div key={p} style={{ fontSize: 13, marginTop: 4 }}>{p}</div>)}
            </div>
          )}

          {openJob ? (
            <>
              <button type="button" className="fs-back-link" onClick={() => setOpenId(null)}><FsIcon name="back" size={16} />{TAB_TITLE[navKey]}</button>
              <TechJobScreen key={openJob.id} job={openJob} uid={uid ?? ''} lists={lists} onBack={() => setOpenId(null)} act={act}
                onRefresh={() => uid && loadLive(uid, false)} refreshing={refreshing}
                onCheckIn={setCheckIn} onArrive={(j) => void arriveFrom(j)} keepPhoto={keepFor(openJob)} dayBusy={dayBusy}
                techName={profile?.name ?? ''} />
            </>
          ) : tab === 'project' ? (
            <ProjectTab jobs={jobs} onOpen={openFromList} onCheckIn={setCheckIn} onArrive={(j) => void arriveFrom(j)} busy={dayBusy} />
          ) : underProfile ? (
            <>
              <button type="button" className="fs-back-link" onClick={() => go('profile')}><FsIcon name="back" size={16} />Profile</button>
              {tab === 'jobs' ? (
                <JobsHome
                  name={profile?.name ?? ''} jobs={jobs} counts={counts} offers={offers.length}
                  paperworkDue={paperworkDue} profile={profile} projects={projectJobs.length}
                  onOpen={openFromList} go={go}
                />
              ) : (
                <>
                  <FsPageHeader title="Available jobs" subtitle="Jobs offered to you. Accept or decline." />
                  <AvailableTab offers={offers} act={act} onOpen={openFromList} />
                </>
              )}
            </>
          ) : tab === 'projects' ? (
            <ProjectsTab jobs={projectJobs} onOpen={openFromList} />
          ) : tab === 'schedule' ? (
            <>
              <FsPageHeader title="My Schedule" subtitle="Every day you are booked, in order." />
              <TechSchedule jobs={jobs} crewWeeks={[]} onOpen={openFromList} onOpenCrew={() => {}} />
            </>
          ) : tab === 'chat' ? (
            <>
              <FsPageHeader title="Messenger" subtitle="Talk about your work orders." />
              <TechChat
                jobs={jobs.filter((j) => !isFinished(j) && j.status !== 'declined').map(toChatJob)}
                onRead={async () => {
                  const [u1, u2] = await Promise.all([fetchTechUnread(), fetchTechDmUnread()]);
                  setUnread(u1 + u2);
                }}
              />
            </>
          ) : tab === 'profile' && profile ? (
            <>
              <FsPageHeader title="Profile" subtitle={`${profile.name} · Technician`} />
              <ProfileMenu offers={offers.length} go={go} />
              <div style={{ marginBottom: 18, maxWidth: 480 }}>
                <PushSwitch onText="On. New work orders and messages pop up on this phone, even with the app closed."
                  offText="Turn on so new work orders and messages pop up on this phone, even with the app closed." />
              </div>
              <ProfileTab
                profile={profile} portalToken={portalToken} onSignOut={signOut} wide={wide} onWide={setWide}
                onSaved={(p) => { setProfile(p); if (uid) saveCopy(kv, uid, 'profile', p); }}
                onFiled={() => { if (uid) void loadLive(uid, true); }}
              />
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}

// ── Project: Field Service's "My work orders" ───────────────────────────────
// Every open work order as a card (today's outlined), with the counts on top
// and finished work folded away underneath — as in Field Service LIVE.
/** On the way to the hotel or home: Sign out for the day, at the top of every screen. */
function DayStrip({ job, busy, onSignOut }: { job: WfJob; busy: boolean; onSignOut: () => void }) {
  const st = dayState(job.myDay ?? []);
  const since = st.stage === 'travel' ? ` · since ${new Date(st.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
  return (
    <div className="fs-day-strip" role="region" aria-label="Your day">
      <span><b>{onTheWay(st.stage === 'travel' ? st.dest : 'hotel')}</b><small>WO {job.number}{since}</small></span>
      <button type="button" disabled={busy} onClick={onSignOut}>{busy ? 'One moment…' : 'Sign out for the day'}</button>
    </div>
  );
}

/**
 * The first thing after logging in (Fred, 2026-10-18: "when they log in it should ask"):
 * Check in for today's job, or the one step that's next on the job they're in the middle of.
 */
function TodayCard({ jobs, onOpen, onCheckIn, onArrive, busy }: {
  jobs: WfJob[]; onOpen: (id: string) => void; onCheckIn: (job: WfJob) => void; onArrive: (job: WfJob) => void; busy: boolean;
}) {
  const today = todayISO();
  const now = new Date();
  const lastAt = (j: WfJob) => (j.myDay ?? []).reduce((m, e) => (e.at > m ? e.at : m), '');
  // The job they're in the middle of today: on the road, on site, at lunch, or off site.
  const inProgress = jobs
    .filter((j) => j.dayFlow && (canWork(j) || j.status === 'workDone'))
    .map((j) => ({ j, st: fsStage(j.myDay ?? [], {}, now, 'America/New_York') }))
    .filter((x) => x.st !== 'ready' && x.st !== 'done')
    .sort((a, b) => lastAt(b.j).localeCompare(lastAt(a.j)))[0] ?? null;
  const choices = sortTechJobs(jobs.filter((j) => canWork(j) && j.dayFlow), today);
  const [pick, setPick] = useState<string>('');
  if (!inProgress && choices.length === 0) return null;
  const job = inProgress?.j ?? choices.find((j) => j.id === pick) ?? choices[0];
  const stage = inProgress?.st ?? fsStage(job.myDay ?? [], {}, now, 'America/New_York');
  const st = dayState(job.myDay ?? [], now);
  const since = 'since' in st ? new Date(st.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
  const name = job.siteName || job.title || `WO ${job.number}`;
  let line: string;
  let action: React.ReactNode;
  if (stage === 'outbound' || stage === 'returning') {
    const dest = st.stage === 'travel' ? st.dest : 'site';
    line = `${onTheWay(dest)}${since ? ` since ${since}` : ''}.`;
    action = (
      <button type="button" className="fs-btn fs-btn-primary fs-btn-big" disabled={busy} onClick={() => onArrive(job)}>
        {dest === 'hotel' || dest === 'home' ? 'Sign out for the day' : 'I have arrived'}
      </button>
    );
  } else if (stage === 'onsite' || stage === 'lunch' || stage === 'stopped') {
    line = `${stage === 'lunch' ? 'At lunch' : 'On site'} at ${name}${since ? ` since ${since}` : ''}.`;
    action = <button type="button" className="fs-btn fs-btn-primary fs-btn-big" onClick={() => onOpen(job.id)}>Open the job</button>;
  } else {
    // Ready for the day, off site, or signed out at the hotel: the next check-in.
    line = stage === 'offsite' ? `Off site at ${name}. Where to now?`
      : stage === 'clocked' ? 'Checked in. Where are you driving?' : 'Ready to go? Check in before you drive off.';
    action = (
      <button type="button" className="fs-btn fs-btn-primary fs-btn-big" disabled={busy || job.status === 'offered'} onClick={() => onCheckIn(job)}>
        <FsIcon name="clock" /> {stage === 'offsite' || stage === 'clocked' ? 'Check in for the next drive' : 'Check in'}
      </button>
    );
  }
  return (
    <section className="fs-card fs-form fs-today" aria-label="Today">
      <h3>Today</h3>
      {!inProgress && choices.length > 1 ? (
        <label>
          Job
          <select value={job.id} onChange={(e) => setPick(e.target.value)}>
            {choices.map((j) => <option key={j.id} value={j.id}>{[j.siteName || j.title, `WO ${j.number}`, j.date === today ? 'today' : ''].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
      ) : (
        <p className="fs-meta">{[name, `WO ${job.number}`].join(' · ')}</p>
      )}
      <p>{line}</p>
      {action}
    </section>
  );
}

// Fred, 2026-10-18: "Under work order should have assigned and available and
// pending" — Assigned (yours: upcoming and in progress), Available (offered to
// you, waiting for Accept or Decline) and Pending (Work done, waiting for the
// office to close it).
type WoList = 'assigned' | 'available' | 'pending';

function ProjectTab({ jobs, onOpen, onCheckIn, onArrive, busy }: {
  jobs: WfJob[]; onOpen: (id: string) => void; onCheckIn: (job: WfJob) => void; onArrive: (job: WfJob) => void; busy: boolean;
}) {
  const today = todayISO();
  const live = sortTechJobs(jobs.filter(canWork), today);
  const todayCount = live.filter((j) => j.date === today || isClockedIn(j)).length;
  const lists: Record<WoList, WfJob[]> = {
    assigned: live,
    available: sortTechJobs(jobs.filter((j) => j.status === 'offered'), today),
    pending: sortTechJobs(jobs.filter((j) => j.status === 'workDone'), today),
  };
  const past = sortTechJobs(jobs.filter((j) => j.status === 'closed'), today);
  const [list, setList] = useState<WoList>(() => (lists.assigned.length === 0 && lists.available.length > 0 ? 'available' : 'assigned'));
  const EMPTY: Record<WoList, string> = {
    assigned: "No work assigned right now. New work orders appear here as soon as they're assigned to you.",
    available: 'Nothing waiting for your answer. Jobs offered to you show here to accept or decline.',
    pending: 'Nothing waiting for approval. Jobs you mark Work done wait here until they are closed.',
  };
  const card = (j: WfJob) => {
    const isToday = j.date === today;
    const start = parseClockTime(j.startTime);
    const end = parseClockTime(j.endTime);
    const day = !j.date ? 'Not scheduled yet' : isToday ? 'Today'
      : new Date(`${j.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const time = start ? ` · ${fmtClock12(start)}${end ? ` – ${fmtClock12(end)}` : ''}` : '';
    // A job with the day says where the tech is in it, as Field Service does.
    const stage = j.dayFlow && canWork(j) ? fsStage(j.myDay ?? [], {}, undefined, 'America/New_York') : 'ready';
    const [label, tone, dot]: [string, 'green' | 'amber' | 'grey', boolean] =
      stage !== 'ready' ? [FS_STAGE_NAME[stage], 'green', true]
      : isClockedIn(j) ? ['Clocked in', 'green', true]
        : j.status === 'inProgress' ? ['In progress', 'green', true]
          : j.status === 'workDone' ? ['Work done', 'amber', false]
            : j.status === 'closed' ? ['Accepted', 'green', false]
              : j.status === 'offered' ? ['Waiting for your answer', 'amber', false]
                : ['Not started', 'grey', false];
    const where = fullAddress(j);
    return (
      <button type="button" key={j.id} className={`fs-card fs-wo-card${isToday ? ' today' : ''}`} onClick={() => onOpen(j.id)}>
        <div className="fs-card-top"><h3>{j.siteName || j.title}</h3><FsChip tone={tone} dot={dot}>{label}</FsChip></div>
        <p className="fs-meta">{[j.client, j.siteName ? j.title : '', `WO ${j.number}`].filter(Boolean).join(' · ')}</p>
        <p className="fs-when"><FsIcon name="clock" size={16} />{day}{time}</p>
        {where && where !== j.siteName && <p className="fs-meta"><FsIcon name="pin" size={14} />{where}</p>}
        <span className="fs-go">Open work order<FsIcon name="arrow" size={16} /></span>
      </button>
    );
  };
  return (
    <>
      <FsPageHeader title="Work orders" subtitle="Your assigned work, one tap away." />
      <TodayCard jobs={jobs} onOpen={onOpen} onCheckIn={onCheckIn} onArrive={onArrive} busy={busy} />
      <div className="fs-stat-grid">
        <div className="fs-card fs-stat-card">
          <div>Open work orders<FsIcon name="sheet" size={18} /></div>
          <strong>{live.length}</strong><small>Assigned to you</small>
        </div>
        <div className="fs-card fs-stat-card">
          <div>Today<FsIcon name="clock" size={18} /></div>
          <strong>{todayCount}</strong><small>On your schedule today</small>
        </div>
      </div>
      <div className="fs-segmented" role="group" aria-label="Work orders" style={{ marginBottom: 18 }}>
        {([['assigned', 'Assigned'], ['available', 'Available'], ['pending', 'Pending']] as [WoList, string][]).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={list === k} onClick={() => setList(k)}>
            {label} ({lists[k].length})
          </button>
        ))}
      </div>
      <div className="fs-wo-grid">
        {lists[list].map(card)}
        {lists[list].length === 0 && <p className="fs-card fs-empty">{EMPTY[list]}</p>}
      </div>
      {past.length > 0 && (
        <details className="fs-past">
          <summary>Earlier work ({past.length})</summary>
          <div className="fs-wo-grid">{past.map(card)}</div>
        </details>
      )}
    </>
  );
}

/** Profile's menu: the lists that used to be tabs. */
function ProfileMenu({ offers, go }: { offers: number; go: (t: Tab) => void }) {
  return (
    <div className="fs-card fs-menu-card">
      <button type="button" onClick={() => go('jobs')}><FsIcon name="sheet" size={18} /> My jobs</button>
      <button type="button" onClick={() => go('available')}>
        <FsIcon name="inbox" size={18} /> Available jobs{offers > 0 && <em>{offers}</em>}
      </button>
    </div>
  );
}

// ── Paperwork before anything else ──────────────────────────────────────────

function PaperworkGate({ profile, portalToken, onFiled, onRetry, onSignOut }: {
  profile: TechProfile; portalToken: string | null;
  onFiled: () => void; onRetry: () => void; onSignOut: () => void;
}) {
  const w9 = !!profile.w9_received;
  const agreement = !!profile.contract_signed_at;
  const step = (done: boolean, n: number, title: string, note: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <span style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, background: done ? 'var(--wf-success)' : 'var(--wf-navy)', color: '#fff',
      }}>{done ? <CheckCircle2 size={17} /> : n}</span>
      <span style={{ flex: 1 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{title}</span>
        <span className="wf-subtle" style={{ fontSize: 12.5 }}>{done ? 'Done' : note}</span>
      </span>
    </div>
  );
  return (
    <div className="wf wf-page fs">
      <Toaster />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 48px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="wf-hero">
          <div className="wf-hero-date">FAJ Solutions · Tech Portal</div>
          <h1 className="wf-hero-greet">Welcome, {profile.name.split(/\s+/)[0]}</h1>
          <div style={{ color: 'rgba(255,255,255,0.85)', marginTop: 8, maxWidth: 520 }}>
            Before you can see your jobs, we need two things from you. It takes a few minutes, and you only do it once.
          </div>
        </div>

        <div className="wf-card" style={{ padding: '6px 16px' }}>
          {step(agreement, 1, 'Sign the contractor agreement', 'Read it and type your name to sign.')}
          <div style={{ borderTop: '1px solid var(--wf-line)' }} />
          {step(w9, 2, 'File your W-9', 'Needed before you can be paid, and for your 1099 at tax time.')}
        </div>

        <div className="wf-card" style={{ padding: 16 }}>
          {portalToken ? (
            // The SAME component and API route the emailed portal link uses.
            // Tax IDs travel one audited path, not two.
            <PortalDocuments
              token={portalToken}
              w9Received={w9}
              w9SubmittedAt={profile.w9_submitted_at}
              contractUrl={null}
              contractSignedAt={profile.contract_signed_at}
              contractSignedName={null}
              contractorName={profile.name}
              onFiled={onFiled}
            />
          ) : (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <div style={{ fontWeight: 600 }}>The forms need signal to open.</div>
              <button className="wf-btn wf-btn-navy" style={{ marginTop: 10 }} onClick={onRetry}><RefreshCw size={16} /> Try again</button>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center' }}>
          <div className="wf-subtle" style={{ fontSize: 12.5, marginBottom: 8 }}>
            Your tax number goes straight to FAJ&apos;s secure files. It is never kept on this phone.
          </div>
          <button className="wf-btn wf-btn-ghost wf-btn-sm" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </div>
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

// ── Jobs (Primio's home) ───────────────────────────────────────────────────

function JobsHome({ name, jobs, counts, offers, paperworkDue, profile, projects, onOpen, go }: {
  name: string; jobs: WfJob[]; counts: ReturnType<typeof techCounts>; offers: number;
  paperworkDue: number; profile: TechProfile | null; projects: number;
  onOpen: (id: string) => void; go: (t: Tab) => void;
}) {
  const [search, setSearch] = useState('');
  // Fred, 2026-10-07: "show schedule, assigned, pending, completed, and
  // declined" — always all five, with their counts. Assigned jobs (still
  // needing a yes or no) are here too, as well as under Available.
  // Fred, again the same day: "all jobs removed" — just the five. It opens on
  // Scheduled, or the first list that has anything in it. A search looks
  // through all five.
  const [filter, setFilter] = useState<TechFilter>(() =>
    TECH_FILTERS.find((f) => jobs.some((j) => techFilterOf(j.status) === f.key))?.key ?? 'scheduled');
  // Project sites have their own list (Projects, under My jobs). An offer
  // still shows here under Assigned until it's accepted.
  const mine = jobs.filter((j) => (!j.isProject || j.status === 'offered') && techFilterOf(j.status) && matchesWf(j, search));
  const searching = search.trim() !== '';
  const shown = sortTechJobs(searching ? mine : mine.filter((j) => techFilterOf(j.status) === filter));
  const EMPTY: Record<TechFilter, string> = {
    scheduled: offers > 0 ? 'Nothing scheduled. Accept a job under Assigned and it shows here.' : 'Nothing scheduled right now.',
    assigned: 'Nothing waiting for your answer.',
    pending: 'Nothing waiting for approval.',
    completed: 'No completed jobs in the last 45 days.',
    declined: "You haven't declined any jobs.",
  };
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
      <Banner
        title="Available jobs"
        subtitle={offers > 0 ? `${offers} ${offers === 1 ? 'job is' : 'jobs are'} waiting for your answer` : 'No new jobs right now'}
        onClick={() => go('available')}
      />
      {projects > 0 && (
        <Banner
          title="Projects"
          subtitle={`${projects} project ${projects === 1 ? 'site' : 'sites'}: travel, time on site, receipts`}
          onClick={() => go('projects')}
        />
      )}
      {paperworkDue > 0 && profile && (
        <button className="wf-card wf-card-click" onClick={() => go('profile')}
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderColor: 'rgba(180,83,9,0.35)', background: 'rgba(180,83,9,0.05)' }}>
          <FileWarning size={22} color="var(--wf-warning)" />
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontWeight: 700, color: 'var(--wf-warning)' }}>
              {!profile.w9_received && !profile.contract_signed_at ? 'Your W-9 and agreement are outstanding'
                : !profile.w9_received ? 'Your W-9 is outstanding' : 'Your contractor agreement is unsigned'}
            </span>
            <span className="wf-subtle" style={{ fontSize: 12.5 }}>We can&apos;t pay you without it. Tap to finish — it takes a minute.</span>
          </span>
        </button>
      )}

      <h2 className="wf-title">Work orders</h2>
      <Filters
        value={searching ? 'all' : filter}
        showAll={false}
        options={TECH_FILTERS.map((f) => ({ key: f.key, label: f.label, count: mine.filter((j) => techFilterOf(j.status) === f.key).length }))}
        onChange={(v) => { if (v !== 'all') { setFilter(v); setSearch(''); } }}
      />
      <input className="wf-input" value={search} onChange={(e) => setSearch(e.target.value)}
        placeholder="Search WO number, client, city…" aria-label="Search your jobs" />
      {shown.length === 0 ? (
        <Empty
          title={searching ? 'Nothing matches your search' : 'No jobs here'}
          message={searching ? 'Try another word, or clear the search.' : EMPTY[filter]}
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))', gap: 12 }}>
          {shown.map((j, i) => <JobCard key={j.id} job={j} index={i} onOpen={() => onOpen(j.id)} />)}
        </div>
      )}
    </div>
  );
}

// ── Projects (migration 117) ────────────────────────────────────────────────

/** Project sites, grouped by project: name, date and time, WO number, a line of what it is. */
function ProjectsTab({ jobs, onOpen }: { jobs: WfJob[]; onOpen: (id: string) => void }) {
  const groups = new Map<string, WfJob[]>();
  for (const j of sortTechJobs(jobs)) {
    const k = j.projectName?.trim() || 'Project';
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  if (jobs.length === 0) {
    return <Empty title="No projects yet" message="When the office puts you on a project site, it shows here with Start travel, Start job, Off site and the drive to the hotel or home." />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <PushSwitch onText="On. Questions and replies from the project manager pop up here right away."
        offText="Turn on so the project manager's questions and replies pop up on this phone right away." />
      {[...groups.entries()].map(([name, list]) => {
        const open = list.filter((j) => !isFinished(j));
        return (
          <section key={name} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <h2 className="wf-title" style={{ margin: 0 }}>{name}</h2>
              <div className="wf-subtle" style={{ fontSize: 12.5 }}>
                {list.length} {list.length === 1 ? 'site' : 'sites'}{open.length < list.length ? ` · ${list.length - open.length} finished` : ''}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))', gap: 12 }}>
              {list.map((j, i) => <JobCard key={j.id} job={j} index={i} brief onOpen={() => onOpen(j.id)} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// ── Available (Primio's Available jobs, without pay) ───────────────────────

function AvailableTab({ offers, act, onOpen }: {
  offers: WfJob[]; act: (a: PendingAction, sent?: string) => Promise<void>; onOpen: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [workType, setWorkType] = useState<WfWorkType | 'all'>('all');
  // Where the tech is now, for "12.4 mi" (Fred: "show full address and distance").
  const [here, setHere] = useState<Position | null>(null);
  useEffect(() => {
    let off = false;
    void getPosition(8000).then((p) => { if (!off) setHere(p); });
    return () => { off = true; };
  }, []);
  const searched = offers.filter((j) => matchesWf(j, search));
  const typeCounts = new Map<WfWorkType, number>();
  for (const j of searched) { const t = workTypeFor(j.serviceType, j.title); typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1); }
  const typeOptions = (Object.keys(WF_WORK_TYPE_LABEL) as WfWorkType[])
    .filter((t) => typeCounts.has(t)).map((t) => ({ key: t, label: WF_WORK_TYPE_LABEL[t], count: typeCounts.get(t) ?? 0 }));
  const type = workType !== 'all' && typeCounts.has(workType) ? workType : 'all';
  const shown = sortWf(searched.filter((j) => type === 'all' || workTypeFor(j.serviceType, j.title) === type));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 760 }}>
      <div style={{ position: 'relative' }}>
        <Search size={18} color="var(--wf-subtle)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
        <input className="wf-input" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search job, ID, client or city" aria-label="Search available jobs" style={{ paddingLeft: 40 }} />
      </div>
      {typeOptions.length > 0 && (
        <Filters value={type} options={typeOptions} onChange={setWorkType} allLabel="All work" ariaLabel="Show jobs by type of work" />
      )}
      {shown.length === 0 ? (
        <Empty
          icon={<Inbox size={34} />}
          title="No available jobs"
          message={offers.length ? 'Nothing matches your filters right now.' : 'New jobs sent to you show up here to accept.'}
        />
      ) : shown.map((j, i) => <AvailableJobCard key={j.id} job={j} here={here} index={i} act={act} onOpen={() => onOpen(j.id)} />)}
    </div>
  );
}

function AvailableJobCard({ job, here, index, act, onOpen }: {
  job: WfJob; here: Position | null; index: number;
  act: (a: PendingAction, sent?: string) => Promise<void>; onOpen: () => void;
}) {
  const miles = here && job.siteLat != null && job.siteLng != null ? milesBetween(here.lat, here.lng, job.siteLat, job.siteLng) : null;
  const address = fullAddress(job);
  const meta = (icon: React.ReactNode, text: string) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 13, marginTop: 4 }}>
      <span style={{ color: 'var(--wf-gold)', flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{text}</span>
    </div>
  );
  return (
    <div className="wf-card wf-rise" style={{ padding: 14, animationDelay: `${Math.min(index, 12) * 70}ms` }}>
      <button onClick={onOpen} aria-label={`WO ${job.number}: ${job.title}`}
        style={{ display: 'block', width: '100%', padding: 0, border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="wf-label" style={{ flex: 1, minWidth: 0 }}>WO {job.number} · {WF_WORK_TYPE_LABEL[workTypeFor(job.serviceType, job.title)]}</span>
          {job.highPriority && <span className="wf-chip" style={{ color: 'var(--wf-danger)', background: 'rgba(198,40,40,0.1)', padding: '1px 8px' }}>High priority</span>}
        </div>
        <div style={{ fontWeight: 600, fontSize: 16, marginTop: 4, lineHeight: 1.3 }}>{job.title}</div>
        {job.client && <div className="wf-subtle" style={{ fontSize: 13 }}>{job.client}</div>}
        {meta(<CalendarDays size={15} />, whenText(job))}
        {meta(<MapPin size={15} />, [address || 'Address not on file', miles != null ? `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi away` : ''].filter(Boolean).join(' · '))}
      </button>
      <TimeRequestLine job={job} ownerView={false} />
      <div style={{ marginTop: 12 }}><OfferButtons job={job} act={act} /></div>
    </div>
  );
}

// ── Accept / Not interested ─────────────────────────────────────────────────

function OfferButtons({ job, act }: { job: WfJob; act: (a: PendingAction, sent?: string) => Promise<void> }) {
  const [askOpen, setAskOpen] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="wf-btn wf-btn-gold" style={{ flex: '1 1 100%' }}
        onClick={() => void act(makeAction('respond', { number: job.number, accept: true }, `Accept WO ${job.number}`), 'Accepted. It is in My jobs.')}>
        <ThumbsUp size={16} /> Accept
      </button>
      {/* Fred, 2026-10-04: counter-offers from Primio, but never about pay —
          a tech can only ask for another date and time. */}
      <button className="wf-btn wf-btn-outline" style={{ flex: '1 1 0', minWidth: 0 }} onClick={() => setAskOpen(true)}>
        <CalendarClock size={16} /> Another time
      </button>
      <button className="wf-btn wf-btn-outline" style={{ flex: '1 1 0', minWidth: 0 }}
        onClick={() => {
          if (!confirm(`Decline WO ${job.number}? It goes back so it can go to someone else.`)) return;
          void act(makeAction('respond', { number: job.number, accept: false }, `Decline WO ${job.number}`), 'Declined.');
        }}>
        <ThumbsDown size={16} /> Decline
      </button>
      {askOpen && <TimeRequestDialog job={job} act={act} onClose={() => setAskOpen(false)} />}
    </div>
  );
}

/** Ask Fred for another date and time on an offer, with a note. Never pay. */
function TimeRequestDialog({ job, act, onClose }: {
  job: WfJob; act: (a: PendingAction, sent?: string) => Promise<void>; onClose: () => void;
}) {
  const mine = job.myTimeRequest?.state === 'waiting' ? job.myTimeRequest : null;
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [date, setDate] = useState(mine?.date ?? '');
  const [time, setTime] = useState(mine?.time ?? '');
  const [note, setNote] = useState(mine?.note ?? '');
  const send = (withdraw: boolean) => {
    onClose();
    void act(
      makeAction('timeRequest', withdraw ? { number: job.number, date: null } : { number: job.number, date, time, note: note.trim() },
        withdraw ? `Take back the time ask on WO ${job.number}` : `Ask for another time on WO ${job.number}`),
      withdraw ? 'Ask taken back.' : 'Sent. The answer shows on the job.',
    );
  };
  return (
    <Dialog title="Ask for another time" onClose={onClose}
      footer={<>
        {mine && <button className="wf-btn wf-btn-ghost" onClick={() => send(true)}>Take back my ask</button>}
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!date || date < minDate} onClick={() => send(false)}>
          <Send size={16} /> Send
        </button>
      </>}>
      <p style={{ marginTop: 0 }}>
        WO {job.number} is set for <b>{job.date ? requestWhen({ date: job.date, time: job.startTime }) : 'no date yet'}</b>.
        Pick a time that works for you — we&apos;ll use it or keep the original.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 150px' }}>
          <label className="wf-label" htmlFor={`ask-date-${job.id}`} style={{ display: 'block', marginBottom: 4 }}>Date</label>
          <input id={`ask-date-${job.id}`} className="wf-input" type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div style={{ flex: '1 1 120px' }}>
          <label className="wf-label" htmlFor={`ask-time-${job.id}`} style={{ display: 'block', marginBottom: 4 }}>Start time</label>
          <input id={`ask-time-${job.id}`} className="wf-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
      <label className="wf-label" htmlFor={`ask-note-${job.id}`} style={{ display: 'block', margin: '12px 0 4px' }}>Note</label>
      <textarea id={`ask-note-${job.id}`} className="wf-input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="I'm on another job until 3. I can be there by 4." />
    </Dialog>
  );
}

// ── One job ─────────────────────────────────────────────────────────────────

function TechJobScreen({ job, uid, lists, onBack, act, onRefresh, refreshing, onCheckIn, onArrive, keepPhoto, dayBusy, techName }: {
  job: WfJob; uid: string; lists: CloseoutList[]; onBack: () => void; act: (a: PendingAction, sent?: string) => Promise<void>;
  onRefresh: () => void; refreshing: boolean;
  /** Check in (components/wf/CheckIn.tsx), and arriving with the ending mileage: shared with the first screen. */
  onCheckIn: (job: WfJob) => void; onArrive: (job: WfJob) => void; keepPhoto: SavePhoto;
  /** Arriving is finding the GPS position (shared with the first screen). */
  dayBusy: boolean;
  /** The tech's own name, for the client's checkout form. */
  techName: string;
}) {
  // The client's links for the day (migration 133): the checkout form opens when they go off site.
  const siteLinks = useSiteLinks(job.number);
  const [checkoutAt, setCheckoutAt] = useState<string | null>(null);
  /** The client's checkout form, filled in with this job and today's times (lib/site-links.ts). */
  const checkoutHref = (off: string) => siteLinks.checkout ? checkoutFormUrl(siteLinks.checkout, {
    // The client's own numbers (migration 135): their Site ID, and their ticket, never FAJ's WO number.
    siteId: siteLinks.siteId ?? siteIdOf(job.title), wo: siteLinks.ticket ?? '', name: techName,
    on: onSiteSince(job.myDay ?? [], off, 'America/New_York'), off, timeZone: 'America/New_York',
  }) : null;
  const [chatOpen, setChatOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // The job report (Fred, 2026-10-02: "add info to the work orders, save,
  // close, answer questions"). Edits live here until Save or Work done.
  const [notes, setNotes] = useState(job.closeoutNotes);
  const msgDraft = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const ph = useJobPhotos(job, uid);
  const photoCount = ph.sent.length + ph.waiting.length;
  const [noteOpen, setNoteOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  // One page (Fred, 2026-10-18): Messages in a pop-up, and a photo that asks what it's for.
  const [msgOpen, setMsgOpen] = useState(false);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [expenseFile, setExpenseFile] = useState<File | null>(null);
  const [odoFile, setOdoFile] = useState<File | null>(null);
  const [expenses, setExpenses] = useState<TechExpense[]>([]);
  const loadExpenses = useCallback(async () => {
    const { data, error } = await createClient().rpc('wf_tech_job_expenses', { p_wo_number: job.number });
    if (!error && Array.isArray(data)) setExpenses(data as TechExpense[]);
  }, [job.number]);
  useEffect(() => { void loadExpenses(); }, [loadExpenses]);
  const working = canWork(job);
  const canReport = working || job.status === 'workDone';
  const checklist = useMemo(() => listFor(lists, job.title, job.description), [lists, job.title, job.description]);
  // Only what the office asked for on this job (lib/capture.ts); a job with no list asks for everything.
  const ask = (k: CaptureItem) => asks(job.capture, k);
  const shown = askedOnly(job);
  const deliverables = askedDeliverables(job, checklist.items);
  const [odometer, setOdometer] = useState<OdometerMoment | null>(null);
  const [odoRequired, setOdoRequired] = useState(false);
  // A project site always needs the signature, or the reason there isn't one.
  const project = !!job.isProject;
  // The day of travel, lunch and time on site: project jobs, and every job once
  // the database sends the day for it (migration 127) on the Field Service screen.
  const dayFlow = project || (FS_JOB_SCREEN && !!job.dayFlow);
  const jobForCloseout = project && ask('signature') ? { ...shown, signatureRequired: true } : shown;
  // The live sheet's messages: No access, the PM's questions (migration 121).
  const talk = useSiteTalk(job.number, dayFlow && job.status !== 'offered' && job.status !== 'declined');
  // Running late, and stepped off site (migration 122).
  const late = useLateMarks(job.number, project && working);
  const [offOpen, setOffOpen] = useState(false);
  // A project site shows only its date, time, description and the day card
  // until Start job; the whole job opens while they're on site.
  const dayStage = dayFlow ? dayState(job.myDay ?? []).stage : null;
  const left = useLeftSite(job.siteLat, job.siteLng, project && working && dayStage === 'onsite');
  const simple = project && dayStage !== 'onsite' && dayStage !== 'lunch';

  /** One closeout change — sent now, or kept on the phone with no signal. */
  const closeoutOp = (op: CloseoutOp) => {
    void act(makeAction('closeout', { number: job.number, op: op.op, args: closeoutArgs(op) }, `Closeout on WO ${job.number}`));
  };

  /** The customer's sign-off: the signature goes with the job's photos, then the name. */
  const signOff = async (name: string, signature: Blob) => {
    const at = new Date();
    const pos = await getPosition(6000);
    const meta = { woNumber: job.number, blob: signature, takenAt: at.toISOString(), lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null, source: 'camera' as const };
    const r = await sendPhoto(meta);
    if (r === 'offline') await queuePhoto({ ...meta, id: `${Date.now()}-sig`, uid });
    else if ('error' in r) { toastError(`The signature didn't send: ${r.error}`); return; }
    await act(makeAction('closeout', { number: job.number, op: 'sign', args: { name } }, `Customer sign-off on WO ${job.number}`, at), 'Signed off.');
  };
  const dirty = notes.trim() !== job.closeoutNotes.trim()
    || Object.entries(answers).some(([id, v]) => v !== (job.questions.find((q) => q.id === id)?.answer ?? ''));

  // GPS on the clock (Fred, 2026-10-02). The time is the moment of the tap;
  // the position is looked up for a few seconds at most and works with no signal.
  // It is required (2026-10-20): with no fix the clock is not changed.
  const toggleClock = async () => {
    const on = isClockedIn(job);
    const at = new Date();
    setLocating(true);
    const pos = await getPosition(8000);
    setLocating(false);
    if (!pos) { toastError(NEED_GPS); return; }
    void act(
      makeAction('clock', { number: job.number, action: on ? 'out' : 'in', lat: pos.lat, lng: pos.lng, acc: pos.accuracy },
        `Clock ${on ? 'out of' : 'in on'} WO ${job.number}`, at),
      on ? 'Clocked out.' : 'Clocked in. The job is in progress.',
    );
  };
  // The project day (migration 117). Each tap: the time now, the position if
  // the phone gives it within a few seconds, then into the outbox.
  // Required (2026-10-20): with no fix the tap is not saved.
  const where = async () => {
    setLocating(true);
    const pos = await getPosition(8000);
    setLocating(false);
    if (!pos) { toastError(NEED_GPS); return null; }
    return { lat: pos.lat, lng: pos.lng, acc: pos.accuracy };
  };
  const dayTap = async (kind: string, extra: Record<string, unknown>, label: string, sent: string) => {
    const at = new Date();
    const g = await where();
    if (!g) return false;
    await act(makeAction('day', { number: job.number, kind, ...g, ...extra }, `${label} — WO ${job.number}`, at), sent);
    return true;
  };
  const dayOn: DayActions = {
    clockIn: () => void dayTap('day_start', {}, 'Clock in', 'Clocked in. Pick where you are going.'),
    // Check in: the drive from the drop-down, the starting mileage, then the office's items (CheckIn.tsx).
    checkIn: () => onCheckIn(job),
    startTrip: (trip, from) => {
      const leg = tripLeg(trip, job.myDay ?? []);
      // The starting mileage is required on a drive to a site, and only then (lib/checkin.ts needsOdometer).
      void dayTap('travel_start', { origin: from ?? leg.origin, dest: leg.dest }, 'Start travel', 'Travel started. Drive safe.')
        .then((saved) => { if (saved && needsOdometer(leg.dest)) { setOdoRequired(true); setOdometer('start'); } });
    },
    // Arriving asks for the ending mileage right after, so the tap keeps its own time and place.
    startJob: () => onArrive(job),
    lunch: (start) => void dayTap(start ? 'lunch_start' : 'lunch_end', {}, start ? 'Lunch' : 'Back from lunch',
      start ? 'Lunch started.' : 'Back on site.'),
    offSite: () => setOffOpen(true),
    arrived: () => onArrive(job),
  };
  // A project site always needs the sign-off; an ordinary job only when the office asked for one.
  const offSiteMissing = [...reportMissing(job, notes, answers, photoCount), ...closeoutMissing(job.closeout, deliverables, jobForCloseout.signatureRequired)];
  const leaveSite = async (finished: boolean, report?: { done: string; left: string }) => {
    setOffOpen(false);
    const at = new Date();
    const g = await where();
    if (!g) return;
    if (dayState(job.myDay ?? []).stage === 'lunch') {
      await act(makeAction('day', { number: job.number, kind: 'lunch_end', ...g }, `Back from lunch — WO ${job.number}`, at));
    }
    // Then the client's own checkout form, when the job has one (migration 133).
    if (siteLinks.checkout) setCheckoutAt(at.toISOString());
    if (finished) {
      await act(makeAction('report', { number: job.number, notes, answers }, `Job report for WO ${job.number}`));
      setAnswers({});
      await act(makeAction('workdone', { number: job.number, notes, clockOut: isClockedIn(job), ...g }, `Site finished on WO ${job.number}`, at),
        'Site finished and sent to the office. Pick where you are heading.');
    } else {
      await act(makeAction('clock', { number: job.number, action: 'out', ...g }, `Off site — WO ${job.number}`, at),
        'Off site. Pick where you are heading.');
      // Today's report goes on the project sheet (Fred, 2026-10-14: "what was
      // done, what's remaining, and then it asks traveling to home or hotel").
      if (report?.done) {
        const body = `Done today: ${report.done}${report.left ? `\nStill to do: ${report.left}` : ''}`;
        await act(makeAction('sitemsg', { number: job.number, kind: 'report', body, to: 'Everyone' }, `Today's report for WO ${job.number}`, at));
      }
    }
  };

  const toggleTask = (t: WfTask, done: boolean) => {
    void act(makeAction('task', { number: job.number, task: t.id, done }, `${done ? 'Tick' : 'Untick'} "${t.label}" on WO ${job.number}`));
  };

  /** Save notes and answers — sent now, or kept on the phone with no signal. */
  const saveReport = async (extra: Record<string, string> = {}, quiet = false, notesNow: string = notes) => {
    const all = { ...answers, ...extra };
    await act(makeAction('report', { number: job.number, notes: notesNow, answers: all }, `Job report for WO ${job.number}`),
      quiet ? undefined : 'Saved and sent.');
    setAnswers({});
  };

  /** Quick note: added to the end of the notes with the time, and saved. */
  const addNote = async (text: string) => {
    const stamp = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const next = `${notes.trim() ? `${notes.trim()}\n` : ''}${stamp} — ${text.trim()}`;
    setNotes(next);
    await saveReport({}, true, next);
    toastSuccess('Note added to the job.');
  };

  const openMessages = () => {
    setChatOpen(true);
    setTimeout(() => document.getElementById('wf-job-messages')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const showClock = !isFinished(job) && job.status !== 'declined' && job.status !== 'offered';
  let bottom: React.ReactNode = null;
  if (job.status === 'offered') bottom = <OfferButtons job={job} act={act} />;
  else if (working && dayFlow) {
    bottom = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="wf-btn wf-btn-outline" disabled={!dirty} onClick={() => void saveReport()}>
          <Save size={17} /> {dirty ? 'Save notes' : 'Saved'}
        </button>
        <div className="wf-subtle" style={{ fontSize: 12, textAlign: 'center' }}>When the site is done: Off site, then This site is finished.</div>
      </div>
    );
  } else if (working) {
    bottom = (
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="wf-btn wf-btn-outline" style={{ flex: 1 }} disabled={!dirty} onClick={() => void saveReport()}>
          <Save size={17} /> {dirty ? 'Save' : 'Saved'}
        </button>
        <button className="wf-btn wf-btn-navy" style={{ flex: 2 }} onClick={() => setDoneOpen(true)}>
          <CheckCircle2 size={18} /> Work done
        </button>
      </div>
    );
  } else if (job.status === 'workDone') {
    bottom = (
      <div className="wf-card" style={{ padding: 12, textAlign: 'center', color: 'var(--wf-success)', fontWeight: 600 }}>
        Sent — you&apos;re all set.
        {dirty && <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginLeft: 10 }} onClick={() => void saveReport()}><Save size={15} /> Save changes</button>}
      </div>
    );
  }

  const detail = (
      <WfJobDetail
        job={job}
        ownerView={false}
        hideBar
        onBack={onBack}
        onRefresh={onRefresh}
        refreshing={refreshing}
        simple={simple}
        actions={canReport ? (
          <QuickActions
            job={job}
            showClock={showClock && !project}
            clockEnabled={working || isClockedIn(job)}
            locating={locating || dayBusy}
            photoBusy={!!ph.busy}
            onClock={() => void toggleClock()}
            onPhoto={(f) => ph.ask(f, 'camera')}
            onNote={() => setNoteOpen(true)}
            onExpense={() => setExpenseOpen(true)}
            onMessages={openMessages}
          />
        ) : <>
          <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => setChatOpen((v) => !v)} aria-pressed={chatOpen}>
            <MessageSquare size={15} /> Messages
          </button>
          <DirectionsButton job={job} className="wf-btn wf-btn-outline wf-btn-sm" />
        </>}
        clock={project && (working || job.status === 'workDone')
          ? <>
            <SiteAccessBar number={job.number} talk={talk} late={late}
              showProblem={working && (dayStage === 'travel' || dayStage === 'onsite')} />
            <ProjectDayCard job={job} busy={locating || dayBusy} enabled={working} on={dayOn} onReceipt={canReport ? () => setExpenseOpen(true) : undefined} />
            <div style={{ marginTop: 6 }}><SheetLinkButton number={job.number} /></div>
          </>
          : showClock ? <TimeClockCard job={job} enabled={working || isClockedIn(job)} busy={locating || dayBusy} onToggle={() => void toggleClock()} showButton={!canReport} /> : undefined}
        onToggleTask={working ? toggleTask : undefined}
        below={<>
          {job.status !== 'offered' && job.status !== 'declined' && (
            <CloseoutCard job={jobForCloseout} items={deliverables} listName={checklist.name} canEdit={canReport} onOp={closeoutOp} onSign={signOff} />
          )}
          {job.status !== 'offered' && job.status !== 'declined' && (
            <JobReport
              job={job} uid={uid} canEdit={canReport}
              notes={notes} setNotes={setNotes} answers={answers} setAnswers={setAnswers}
              dirty={dirty} onSave={(extra) => saveReport(extra)}
            />
          )}
          {(canReport || expenses.length > 0) && (
            <JobExpenses expenses={expenses} canAdd={canReport} onAdd={() => setExpenseOpen(true)} />
          )}
          <JobPhotos canAdd={canReport} ph={ph} />
          <JobTools job={job} canAdd={canReport} ph={ph} onNote={canReport ? addNote : undefined} />
          {chatOpen && <div id="wf-job-messages"><JobMessages number={job.number} talk={project ? talk : undefined} keep={msgDraft} /></div>}
        </>}
        bottom={simple && job.status !== 'offered' ? undefined : bottom}
      />
  );
  const dialogs = (
    <>
      {offOpen && (
        <OffSiteDialog missing={offSiteMissing} signature={jobForCloseout.signatureRequired} onClose={() => setOffOpen(false)}
          needs={[
            ...(asks(shown.capture, 'notes') ? ['your notes'] : []),
            ...(shown.questions.length ? ['the questions'] : []),
            ...(shown.photoRequired || deliverables.length ? ['the photos'] : []),
            ...(jobForCloseout.signatureRequired ? ['the signature'] : []),
          ]}
          clientCheckout={!!siteLinks.checkout}
          onBack={(report) => void leaveSite(false, report)} onFinished={() => void leaveSite(true)} />
      )}
      {checkoutAt && !offOpen && (
        <CheckoutLinkDialog href={checkoutHref(checkoutAt)} on={onSiteSince(job.myDay ?? [], checkoutAt, 'America/New_York')} off={checkoutAt}
          onClose={() => setCheckoutAt(null)} />
      )}
      {expenseOpen && <ExpenseDialog job={job} initialFile={expenseFile} onClose={() => { setExpenseOpen(false); setExpenseFile(null); }} onSaved={() => { setExpenseOpen(false); setExpenseFile(null); void loadExpenses(); }} />}
      {odometer && <OdometerDialog woNumber={job.number} moment={odometer} required={odoRequired} keep={keepPhoto} initialFile={odoFile}
        onClose={() => { setOdometer(null); setOdoFile(null); setOdoRequired(false); }} />}
      {noteOpen && <NoteDialog onClose={() => setNoteOpen(false)} onSave={async (t) => { setNoteOpen(false); await addNote(t); }} />}
      {left.away && project && working && (
        <LeftSiteDialog onStillHere={() => left.dismiss(30)} onPick={(reason, note) => {
          if (reason === 'Leaving for the day') { left.dismiss(600); setOffOpen(true); return; }
          // Lunch is still on the clock (Fred, 2026-10-21): the project manager is told, nothing stops.
          left.dismiss(reason === 'Lunch' ? 90 : 30);
          void act(makeAction('sitemsg', {
            number: job.number, kind: 'away', to: 'Everyone',
            reason: reason === 'Other' ? note : reason, body: reason !== 'Other' && note ? note : '',
          }, `Stepped off site — WO ${job.number}`), 'Sent to the project manager.');
        }} />
      )}
      {ph.pending && <PhotoLabelDialog preview={ph.pending.preview} choices={photoLabelChoices(deliverables)} onPick={ph.answer} onCancel={ph.cancel} />}
      {doneOpen && (
        <WorkDoneDialog
          job={job}
          missing={[...reportMissing(job, notes, answers, photoCount), ...closeoutMissing(job.closeout, deliverables, shown.signatureRequired)]}
          onClose={() => setDoneOpen(false)}
          onSaveDraft={async () => { setDoneOpen(false); await saveReport(); }}
          onConfirm={async () => {
            setDoneOpen(false);
            const at = new Date();
            const clockOut = isClockedIn(job);
            const pos = await getPosition(6000);
            // The customer's signature is taken under Closeout now, with their name.
            // The report first, then work done — the outbox keeps that order.
            await act(makeAction('report', { number: job.number, notes, answers }, `Job report for WO ${job.number}`));
            setAnswers({});
            void act(
              makeAction('workdone', { number: job.number, notes, clockOut, lat: pos?.lat ?? null, lng: pos?.lng ?? null, acc: pos?.accuracy ?? null },
                `Work done on WO ${job.number}`, at),
              'Work done. Sent.',
            );
          }}
        />
      )}
    </>
  );
  if (!FS_JOB_SCREEN) return <>{detail}{dialogs}</>;

  // Field Service's work order (Fred, 2026-10-18). A job with the day of travel,
  // lunch and time on site shows where the tech is in it; any other job keeps
  // FAJ's plain clock. Every tap still goes through the outbox.
  const stage: FsStage = dayFlow
    ? fsStage(job.myDay ?? [], { openIssue: !!openIssue(talk.msgs) }, undefined, 'America/New_York')
    : isClockedIn(job) ? 'onsite' : 'ready';
  const live = job.status !== 'offered' && job.status !== 'declined';
  // One page, no tabs (Fred, 2026-10-18: "I don't like the tabs ... can we have
  // it all in one continuous page"). The job at the top the way the office sees
  // it (name, location, schedule), a row of icons (Photo, Messages, Directions),
  // the day, the job's details, and the documents at the bottom. Only what the
  // job asks for shows.
  const dayCard = dayFlow && (working || job.status === 'workDone') ? (
    <>
      <SiteAccessBar number={job.number} talk={talk} late={late}
        showProblem={working && (dayStage === 'travel' || dayStage === 'onsite')} />
      <FsStageAction stage={stage} events={job.myDay ?? []} busy={locating || dayBusy} enabled={working} afterWork={job.status === 'workDone'} on={dayOn}
        travel={ask('travel')}
        onReceipt={canReport && ask('receipts') ? () => setExpenseOpen(true) : undefined} />
      {project && <SheetLinkButton number={job.number} />}
    </>
  ) : showClock ? (
    <TimeClockCard job={job} enabled={working || isClockedIn(job)} busy={locating || dayBusy} onToggle={() => void toggleClock()} />
  ) : null;
  /** A photo the tech just took goes where they say (Fred: "the photo and then they ask what type of photo it is"). */
  const pickPhoto = (kind: PhotoKind) => {
    const f = photoFile;
    setPhotoFile(null);
    if (!f) return;
    if (kind === 'job') { ph.ask(f, 'camera'); return; }
    if (kind === 'receipt') { setExpenseFile(f); setExpenseOpen(true); return; }
    setOdoFile(f);
    setOdometer(kind === 'odo_start' ? 'start' : 'end');
  };
  return (
    <div className="fs-stack">
      <DetailHeader job={job} ownerView={false} />
      <JobIcons job={job} canPhoto={canReport} photoBusy={!!ph.busy} onPhoto={(f) => { if (f) setPhotoFile(f); }} onMessages={() => setMsgOpen(true)}
        onReceipt={canReport && ask('receipts') ? () => setExpenseOpen(true) : undefined} />
      {job.status === 'offered' && bottom}
      {dayCard}
      {job.description && (
        <section className="fs-card fs-form">
          <h3>Job description</h3>
          <p className="fs-scope">{job.description}</p>
        </section>
      )}
      <ClientLinksCard number={job.number} siteLinks={siteLinks} checkoutHref={() => checkoutHref(lastOffOrNow(job.myDay ?? [], new Date().toISOString(), 'America/New_York'))} />
      <SiteInfoCard job={job} />
      <InfoListCard title="Skills & tools" rows={[['Skills needed', job.skills], ['Tools to bring', job.tools]]} />
      {ask('checklist') && <ChecklistCard job={job} onToggle={working ? toggleTask : undefined} />}
      {live && (deliverables.length > 0 || jobForCloseout.signatureRequired) && (
        <CloseoutCard job={jobForCloseout} items={deliverables} listName={checklist.name} canEdit={canReport} onOp={closeoutOp} onSign={signOff} />
      )}
      {ask('photos') && <JobPhotos canAdd={canReport} ph={ph} />}
      {live && (ask('notes') || shown.questions.length > 0) && (
        <JobReport
          job={shown} uid={uid} canEdit={canReport}
          notes={notes} setNotes={setNotes} answers={answers} setAnswers={setAnswers}
          dirty={dirty} onSave={(extra) => saveReport(extra)}
        />
      )}
      {(ask('receipts') || expenses.length > 0) && (canReport || expenses.length > 0) && (
        <JobExpenses expenses={expenses} canAdd={canReport && ask('receipts')} onAdd={() => setExpenseOpen(true)} />
      )}
      {dayFlow && live && (
        <section className="fs-card fs-form">
          <h3>My time and travel</h3>
          <FsDayLog events={job.myDay ?? []} />
        </section>
      )}
      <JobTools job={job} canAdd={canReport} ph={ph} onNote={canReport ? addNote : undefined} />
      {job.status !== 'offered' && bottom}
      {msgOpen && (
        <Dialog title="Messages" wide onClose={() => setMsgOpen(false)}>
          <JobMessages number={job.number} talk={dayFlow ? talk : undefined} keep={msgDraft} />
        </Dialog>
      )}
      {photoFile && (
        <PhotoKindDialog odometer={ask('travel') && ask('odometer')} receipts={canReport && ask('receipts')}
          onPick={pickPhoto} onCancel={() => setPhotoFile(null)} />
      )}
      {dialogs}
    </div>
  );
}

type PhotoKind = 'odo_start' | 'odo_end' | 'receipt' | 'job';

/** "What's this photo for?" after the tech takes one: mileage, a receipt, or a job photo. */
function PhotoKindDialog({ odometer, receipts, onPick, onCancel }: {
  odometer: boolean; receipts: boolean; onPick: (k: PhotoKind) => void; onCancel: () => void;
}) {
  const kinds: { key: PhotoKind; label: string; hint: string }[] = [
    ...(odometer ? [
      { key: 'odo_start' as const, label: 'Starting mileage', hint: 'The odometer when you set off' },
      { key: 'odo_end' as const, label: 'Ending mileage', hint: 'The odometer when you got there' },
    ] : []),
    ...(receipts ? [{ key: 'receipt' as const, label: 'Receipt', hint: 'Fuel, food, hotel, parking or materials' }] : []),
    { key: 'job', label: 'Job photo', hint: 'The work, the site or the equipment' },
  ];
  return (
    <Dialog title="What's this photo for?" onClose={onCancel}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {kinds.map((k) => (
          <button key={k.key} type="button" className="wf-btn wf-btn-outline" style={{ justifyContent: 'flex-start', textAlign: 'left', padding: '12px 14px' }}
            onClick={() => onPick(k.key)}>
            <span>
              <span style={{ display: 'block', fontWeight: 700 }}>{k.label}</span>
              <span className="wf-subtle" style={{ display: 'block', fontSize: 12.5, fontWeight: 400 }}>{k.hint}</span>
            </span>
          </button>
        ))}
        <p className="wf-subtle" style={{ margin: '4px 0 0', fontSize: 12.5 }}>The time and where you are are stamped on the photo.</p>
      </div>
    </Dialog>
  );
}

/**
 * The icons under the job: Photo, Receipt, Messages and Directions, one tap each.
 * Receipt only on a job that asks for receipts (Fred, 2026-10-19: "tech is not
 * seeing where to add their receipts").
 */
function JobIcons({ job, canPhoto, photoBusy, onPhoto, onMessages, onReceipt }: {
  job: WfJob; canPhoto: boolean; photoBusy: boolean; onPhoto: (f: File | undefined) => void; onMessages: () => void;
  onReceipt?: () => void;
}) {
  const tile: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 72, padding: '10px 6px', borderRadius: 14, border: '1px solid var(--wf-line)', background: 'var(--wf-card)',
    font: 'inherit', fontWeight: 600, fontSize: 13.5, color: 'var(--wf-text)', cursor: 'pointer', textDecoration: 'none', textAlign: 'center',
  };
  const address = fullAddress(job);
  return (
    <div role="toolbar" aria-label="Job icons" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8 }}>
      {canPhoto && (
        <label style={{ ...tile, opacity: photoBusy ? 0.6 : 1, pointerEvents: photoBusy ? 'none' : 'auto' }}>
          <Camera size={22} /> Photo
          <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(f); }} />
        </label>
      )}
      {onReceipt && <button type="button" style={tile} onClick={onReceipt}><Receipt size={22} /> Receipt</button>}
      <button type="button" style={tile} onClick={onMessages}><MessageSquare size={22} /> Messages</button>
      {address && <DirectionsButton job={job} style={tile} icon={<Navigation size={22} />} />}
    </div>
  );
}

/**
 * The big buttons a tech needs on site, in one row (Fred, 2026-10-02: "build
 * the tech quick actions next" — the idea from SimplySub). Clock in/out,
 * Photo (straight to the camera; stamped and sent like any job photo), Note
 * (a timed line added to the job report), Messages and Directions. Save and
 * Work done stay pinned at the bottom.
 */
function QuickActions({ job, showClock, clockEnabled, locating, photoBusy, onClock, onPhoto, onNote, onExpense, onMessages }: {
  job: WfJob; showClock: boolean; clockEnabled: boolean; locating: boolean; photoBusy: boolean;
  onClock: () => void; onPhoto: (f: File | undefined) => void; onNote: () => void; onExpense: () => void; onMessages: () => void;
}) {
  const on = isClockedIn(job);
  const tile: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 76, padding: '10px 6px', borderRadius: 14, border: '1px solid var(--wf-line)', background: 'var(--wf-card)',
    font: 'inherit', fontWeight: 600, fontSize: 13.5, color: 'var(--wf-text)', cursor: 'pointer', textDecoration: 'none', textAlign: 'center',
  };
  const address = fullAddress(job);
  return (
    <div role="toolbar" aria-label="Quick actions" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(92px, 1fr))', gap: 8, width: '100%' }}>
      {showClock && (
        <button
          style={{ ...tile, background: on ? 'var(--wf-danger)' : 'var(--wf-gold)', color: on ? '#fff' : 'var(--wf-gold-ink)', border: 'none', opacity: clockEnabled ? 1 : 0.5 }}
          disabled={!clockEnabled || locating} onClick={onClock}
        >
          {on ? <StopCircleIcon /> : <PlayCircleIcon />}
          {locating ? 'One moment…' : on ? 'Clock out' : 'Clock in'}
        </button>
      )}
      <label style={{ ...tile, opacity: photoBusy ? 0.6 : 1, pointerEvents: photoBusy ? 'none' : 'auto' }}>
        <Camera size={24} color="var(--wf-navy)" />
        {photoBusy ? 'Sending…' : 'Photo'}
        <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onPhoto(f); }} />
      </label>
      <button style={tile} onClick={onNote}><NotebookPen size={24} color="var(--wf-navy)" /> Note</button>
      <button style={tile} onClick={onExpense}><Receipt size={24} color="var(--wf-navy)" /> Expense</button>
      <button style={tile} onClick={onMessages}><MessageSquare size={24} color="var(--wf-navy)" /> Messages</button>
      {address && <DirectionsButton job={job} style={tile} icon={<Navigation size={24} color="var(--wf-navy)" />} />}
    </div>
  );
}

const PlayCircleIcon = () => <PlayCircle size={24} />;
const StopCircleIcon = () => <StopCircle size={24} />;

// ── Expenses (migration-103) ────────────────────────────────────────────────

type TechExpense = {
  id: string; category: ExpenseCategory; vendor: string | null; amount: number; expense_date: string;
  note: string | null; has_receipt: boolean; status: ExpenseStatus; decline_reason: string | null;
};

/** The tech's receipts on this job and what Fred decided. */
function JobExpenses({ expenses, canAdd, onAdd }: { expenses: TechExpense[]; canAdd: boolean; onAdd: () => void }) {
  const approved = expenses.filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount), 0);
  return (
    <Section
      title="Receipts"
      subtitle={expenses.length ? `${expenses.length} receipt${expenses.length === 1 ? '' : 's'}${approved ? ` · ${fmtMoney(approved)} approved` : ''}` : 'Fuel, hotel, meals, parts, tolls: anything you paid for on this job'}
      right={canAdd ? <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={onAdd}><Receipt size={15} /> Add receipt</button> : undefined}
    >
      {expenses.length === 0 ? (
        <div className="wf-subtle" style={{ fontSize: 13 }}>No receipts yet. Tap Receipt at the top of the job, snap the receipt, and you&apos;re paid back once it&apos;s approved.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {expenses.map((e) => {
            const st = EXPENSE_STATUS[e.status];
            return (
              <div key={e.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{expenseCategoryLabel(e.category)}{e.vendor ? ` · ${e.vendor}` : ''}</div>
                  <div className="wf-subtle" style={{ fontSize: 12.5 }}>
                    {fmtDate(e.expense_date)}{e.has_receipt ? ' · receipt attached' : ' · no receipt photo'}{e.note ? ` · ${e.note}` : ''}
                  </div>
                  {e.status === 'declined' && e.decline_reason && <div style={{ fontSize: 12.5, color: 'var(--wf-danger)' }}>Note: {e.decline_reason}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="wf-display" style={{ fontWeight: 700 }}>{fmtMoney(e.amount)}</div>
                  <span className="wf-chip" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

/** Snap the receipt, say what it was for, and send it to Fred. Needs signal. */
function ExpenseDialog({ job, initialFile, initialCategory = 'materials', onClose, onSaved }: {
  job: WfJob; initialFile?: File | null;
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

  const send = async () => {
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
      title="Add an expense"
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={busy || reading || !amount.trim()} onClick={() => void send()}><Receipt size={16} /> {busy ? 'Sending…' : 'Send'}</button>
      </>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
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
        </div>
        {(reading || ai) && (
          <div className="wf-subtle" style={{ fontSize: 12.5 }} aria-live="polite">
            {reading ? 'Reading the receipt…' : 'Filled in from the photo. Check each one before you send.'}
          </div>
        )}
        <label style={{ display: 'block' }}>{label('Amount')}
          <input className="wf-input" inputMode="decimal" placeholder="$0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <div>
          {label('What was it for?')}
          <div className="wf-filters">
            {/* Fred's list, then the office's own categories (migration 136). */}
            {categories.map((c) => (
              <button key={c.key} className="wf-filter" aria-pressed={category === c.key} onClick={() => setCategory(c.key)}>{c.label}</button>
            ))}
          </div>
        </div>
        {category === 'fuel' && (
          <label style={{ display: 'block' }}>{label('Gallons')}
            <input className="wf-input" inputMode="decimal" placeholder="e.g. 11.2" value={gallons} onChange={(e) => setGallons(e.target.value)} />
          </label>
        )}
        <label style={{ display: 'block' }}>{label('Store')}
          <input className="wf-input" placeholder="e.g. Home Depot" value={vendor} onChange={(e) => setVendor(e.target.value)} />
        </label>
        <label style={{ display: 'block' }}>{label('Date on the receipt')}
          <input className="wf-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label style={{ display: 'block' }}>{label('Note (optional)')}
          <input className="wf-input" placeholder="e.g. 20 Cat6 jacks for the drive-thru run" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
    </Dialog>
  );
}

/** A quick note for the office, added to the job report with the time. */
function NoteDialog({ onClose, onSave }: { onClose: () => void; onSave: (text: string) => void | Promise<void> }) {
  const [text, setText] = useState('');
  return (
    <Dialog
      title="Add a note"
      onClose={onClose}
      footer={<>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!text.trim()} onClick={() => void onSave(text)}><Save size={16} /> Add note</button>
      </>}
    >
      <textarea className="wf-input" rows={4} autoFocus value={text} onChange={(e) => setText(e.target.value)}
        placeholder="What's happening — e.g. Arrived, manager let us in. Rack is in the back office." />
      <div className="wf-subtle" style={{ fontSize: 12, marginTop: 6 }}>Added to the job report with the time. Works with no signal.</div>
    </Dialog>
  );
}

/**
 * The tech's report on the job: answers to the office's questions and notes
 * for the office. Saved with the Save button (or when the work is marked
 * done), and kept on the phone with no signal like every other tap.
 */
function JobReport({ job, canEdit, notes, setNotes, answers, setAnswers, dirty, onSave }: {
  job: WfJob; uid: string; canEdit: boolean;
  notes: string; setNotes: (v: string) => void;
  answers: Record<string, string>; setAnswers: (f: (a: Record<string, string>) => Record<string, string>) => void;
  dirty: boolean; onSave: (extra?: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const value = (q: WfQuestion) => answers[q.id] ?? q.answer;
  const set = (id: string, v: string) => setAnswers((a) => ({ ...a, [id]: v }));
  const answeredCount = job.questions.filter((q) => value(q).trim()).length;

  // A photo, document or signature answer is uploaded straight away and saved.
  const uploadAnswer = async (q: WfQuestion, blob: Blob) => {
    setBusy(q.id);
    const r = await sendPhoto({ woNumber: job.number, blob, takenAt: new Date().toISOString(), lat: null, lng: null, accuracy: null, source: 'camera' });
    setBusy(null);
    if (r === 'offline') { toastError('Photos and signatures for a question need signal. Try again when you have it.'); return; }
    if ('error' in r) { toastError(r.error); return; }
    set(q.id, r.url);
    await onSave({ [q.id]: r.url });
  };

  const photoAnswer = async (q: WfQuestion, file: File | undefined) => {
    if (!file) return;
    setBusy(q.id);
    const at = new Date();
    const pos = await getPosition(6000);
    try {
      const blob = await stampPhoto(file, stampLines({ woNumber: job.number, title: q.label, at, pos }));
      await uploadAnswer(q, blob);
    } catch (e) {
      setBusy(null);
      toastError(e instanceof Error ? e.message : "Couldn't prepare that photo.");
    }
  };

  const isUrl = (v: string) => /^https?:\/\//.test(v);

  return (
    <Section
      title="Job report"
      subtitle={job.questions.length ? `${answeredCount} of ${job.questions.length} questions answered` : asks(job.capture, 'notes') ? 'Your notes' : undefined}
      right={canEdit && dirty ? <span className="wf-chip" style={{ color: 'var(--wf-warning)', background: 'rgba(180,83,9,0.1)' }}>Not saved</span> : undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {job.deliverableInstructions && (
          <div style={{ padding: 10, borderRadius: 10, background: 'rgba(201,162,75,0.1)', fontSize: 13 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>What we need back</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{job.deliverableInstructions}</div>
          </div>
        )}

        {job.questions.map((q) => {
          const v = value(q);
          return (
            <div key={q.id}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{q.label}</div>
              {q.type === 'yes_no' ? (
                <div className="wf-filters">
                  {['Yes', 'No'].map((o) => (
                    <button key={o} className="wf-filter" aria-pressed={v === o} disabled={!canEdit} onClick={() => set(q.id, o)}>{o}</button>
                  ))}
                </div>
              ) : q.type === 'textarea' ? (
                <textarea className="wf-input" rows={3} value={v} disabled={!canEdit} onChange={(e) => set(q.id, e.target.value)} />
              ) : q.type === 'photo' || q.type === 'document' ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {isUrl(v) && (
                    <a href={v} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={v} alt={q.label} style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10 }} />
                    </a>
                  )}
                  {canEdit && (
                    <label className="wf-btn wf-btn-outline wf-btn-sm" style={{ opacity: busy === q.id ? 0.6 : 1 }}>
                      <Camera size={15} /> {busy === q.id ? 'Sending…' : isUrl(v) ? 'Retake' : q.type === 'document' ? 'Photo of the document' : 'Take photo'}
                      <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void photoAnswer(q, f); }} />
                    </label>
                  )}
                </div>
              ) : q.type === 'signature' ? (
                isUrl(v) && !canEdit ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={v} alt="Signature" style={{ maxWidth: 260, borderRadius: 8, border: '1px solid var(--wf-line)' }} />
                ) : (
                  <SignaturePad
                    existing={isUrl(v) ? v : null}
                    busy={busy === q.id}
                    disabled={!canEdit}
                    onSigned={(blob) => void uploadAnswer(q, blob)}
                  />
                )
              ) : (
                <input className="wf-input" value={v} disabled={!canEdit} inputMode={q.type === 'number' ? 'decimal' : undefined}
                  onChange={(e) => set(q.id, e.target.value)} />
              )}
            </div>
          );
        })}

        {asks(job.capture, 'notes') && <div>
          <label className="wf-label" htmlFor={`notes-${job.id}`} style={{ display: 'block', marginBottom: 4, fontWeight: 600, color: 'var(--wf-text)', fontSize: 13.5 }}>
            Your notes
          </label>
          <textarea id={`notes-${job.id}`} className="wf-input" rows={4} value={notes} disabled={!canEdit}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What you did, parts used, anything left to do, anything the client said" />
        </div>}
      </div>
    </Section>
  );
}

/**
 * Work done: says plainly what is still missing (the same rules as the
 * emailed job link), and takes the customer's signature when the job needs one.
 */
function WorkDoneDialog({ job, missing, onClose, onSaveDraft, onConfirm }: {
  job: WfJob; missing: string[]; onClose: () => void;
  onSaveDraft: () => Promise<void>; onConfirm: () => void | Promise<void>;
}) {
  const ready = missing.length === 0;
  return (
    <Dialog
      title={missing.length ? 'Almost there' : 'Mark the work done?'}
      onClose={onClose}
      footer={missing.length ? <>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Back to the job</button>
        <button className="wf-btn wf-btn-outline" onClick={() => void onSaveDraft()}><Save size={16} /> Save what I have</button>
      </> : <>
        <button className="wf-btn wf-btn-ghost" onClick={onClose}>Cancel</button>
        <button className="wf-btn wf-btn-navy" disabled={!ready} onClick={() => void onConfirm()}><CheckCircle2 size={16} /> Work done</button>
      </>}
    >
      {missing.length > 0 ? (
        <>
          <p style={{ marginTop: 0 }}>Before you send the job in, finish these under <b>Closeout</b>, <b>Job report</b> and <b>Photos</b>:</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Your notes and answers are saved, {isClockedIn(job) ? 'you will be clocked out, ' : ''}and the job is marked finished.
          </p>
        </>
      )}
    </Dialog>
  );
}

// ── Photos: date, time and GPS printed on every picture ───────────────────

type SentPhoto = { id: string; url: string; taken_at: string; lat: number | null; lng: number | null; by: string | null };

/** Send one stamped photo. 'offline' when there is no signal (keep it). */
/**
 * One job's day taps, from any screen: Check in, arriving, a photo kept with the
 * job, a line to the office. Each tap takes its own time and the GPS position
 * when the phone gives it, and goes through the outbox, so it works with no signal.
 */
function techDay(job: WfJob, act: (a: PendingAction, sent?: string) => Promise<void>, uid: string, setBusy: (b: boolean) => void,
  onOnSite?: () => void) {
  // Every drive and clock-in needs the GPS (2026-10-20): with no fix the tap is not saved.
  const where = async () => {
    setBusy(true);
    const pos = await getPosition(8000);
    setBusy(false);
    if (!pos) { toastError(NEED_GPS); return null; }
    return { lat: pos.lat, lng: pos.lng, acc: pos.accuracy };
  };
  const day = (kind: string, extra: Record<string, unknown>, label: string, at: Date, g: Record<string, unknown>, sent?: string) =>
    act(makeAction('day', { number: job.number, kind, ...g, ...extra }, `${label} — WO ${job.number}`, at), sent);
  const keep: SavePhoto = async (blob, label, takenAt, pos) => {
    const meta = { woNumber: job.number, blob, takenAt, lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null, source: 'camera' as const, label };
    const r = await sendPhoto(meta);
    if (r === 'offline') {
      const saved = await queuePhoto({ ...meta, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, uid });
      return saved ? 'queued' : { error: "No signal, and the phone couldn't keep the photo (storage full or blocked). Try again when you have signal." };
    }
    return 'error' in r ? { error: r.error } : 'sent';
  };
  /** Arrive on site: the drive ends (when there was one) and the time on site starts. */
  const onSite = async () => {
    const at = new Date();
    const g = await where();
    if (!g) return false;
    if (dayState(job.myDay ?? []).stage === 'travel') await day('travel_end', {}, 'Arrived', at, g);
    await act(makeAction('clock', { number: job.number, action: 'in', ...g }, `Start job on WO ${job.number}`, at),
      'On site. Your time on site is running.');
    onOnSite?.();
    return true;
  };
  const send: CheckInSend = {
    startDrive: async (drive: Drive, startDay: boolean) => {
      const at = new Date();
      const g = await where();
      if (!g) return false;
      // The day starts a second before the drive, so the two stay in order.
      if (startDay) await day('day_start', {}, 'Check in', new Date(at.getTime() - 1000), g);
      await day('travel_start', { origin: drive.origin, dest: drive.dest }, 'Start travel', at, g);
      return true;
    },
    arriveOnSite: onSite,
    keep,
    note: (text: string) => {
      void act(makeAction('sitemsg', { number: job.number, kind: 'report', body: text, to: 'Everyone' }, `Check-in for WO ${job.number}`));
    },
  };
  /** The end of a drive: on site, or at the hotel or home (signed out for the day). */
  const arrive = async () => {
    const st = dayState(job.myDay ?? []);
    if (st.stage === 'travel' && st.dest !== 'site') {
      const g = await where();
      if (!g) return false;
      await day('travel_end', {}, 'Arrived', new Date(), g,
        st.dest === 'hotel' || st.dest === 'home' ? `At the ${st.dest}. Signed out for the day.`
          : st.dest === 'fuel' || st.dest === 'materials' ? `At the ${st.dest === 'fuel' ? 'fuel stop' : 'materials pickup'}. Tap Check in when you head out again.` : 'Arrived.');
      return true;
    }
    return onSite();
  };
  return { send, keep, arrive };
}

async function sendPhoto(p: Omit<QueuedPhoto, 'id' | 'uid'>): Promise<{ url: string } | 'offline' | { error: string }> {
  const fd = new FormData();
  fd.append('wo_number', p.woNumber);
  fd.append('file', new File([p.blob], 'photo.jpg', { type: 'image/jpeg' }));
  fd.append('taken_at', p.takenAt);
  if (p.lat != null && p.lng != null) {
    fd.append('lat', String(p.lat));
    fd.append('lng', String(p.lng));
    if (p.accuracy != null) fd.append('accuracy', String(p.accuracy));
  }
  fd.append('source', p.source);
  if (p.label) fd.append('label', p.label);
  try {
    const res = await fetch('/api/tech/photo', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; url?: string };
    if (res.ok && json.ok) return { url: json.url ?? '' };
    return { error: json.error ?? "Couldn't send the photo." };
  } catch {
    return 'offline';
  }
}

/**
 * Photos on a job (Fred, 2026-10-02: "time and date and GPS location on the
 * pictures"). Each photo has the job, the date and time, and the GPS position
 * printed along the bottom of the picture itself. With no signal the stamped
 * photo waits on the phone and goes to the office later.
 */
/** A job's photos: sent, waiting with no signal, and adding a new one. */
function useJobPhotos(job: WfJob, uid: string) {
  const [sent, setSent] = useState<SentPhoto[]>([]);
  const [waiting, setWaiting] = useState<{ p: QueuedPhoto; url: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const loadSent = useCallback(async () => {
    const { data, error } = await createClient().rpc('wf_tech_job_photos', { p_wo_number: job.number });
    if (!error && Array.isArray(data)) setSent(data as SentPhoto[]);
  }, [job.number]);

  const loadWaiting = useCallback(async () => {
    if (!uid) return;
    const list = await queuedPhotos(uid, job.number);
    setWaiting((old) => {
      old.forEach((w) => URL.revokeObjectURL(w.url));
      return list.map((p) => ({ p, url: URL.createObjectURL(p.blob) }));
    });
  }, [uid, job.number]);

  // Send whatever is waiting, oldest first; stop at the first sign of no signal.
  const flush = useCallback(async () => {
    if (!uid) return;
    let any = false;
    for (const p of await queuedPhotos(uid, job.number)) {
      const r = await sendPhoto(p);
      if (r === 'offline') break;
      await dropQueuedPhoto(p.id);
      any = true;
      if ('error' in r) toastError(`A waiting photo was not accepted: ${r.error}`);
    }
    if (any) { await loadSent(); await loadWaiting(); }
  }, [uid, job.number, loadSent, loadWaiting]);

  useEffect(() => {
    void loadSent();
    void loadWaiting().then(() => flush());
    const back = () => { void flush(); };
    window.addEventListener('online', back);
    return () => window.removeEventListener('online', back);
  }, [loadSent, loadWaiting, flush]);

  const add = async (file: File | undefined, source: 'camera' | 'library', label: string | null = null, when?: Date) => {
    if (!file) return;
    const at = when ?? new Date();
    setBusy('Getting your location…');
    const pos = await getPosition(8000);
    setBusy('Stamping the photo…');
    let blob: Blob;
    try {
      blob = await stampPhoto(file, stampLines({
        woNumber: job.number, title: job.client || job.title, at, pos, fromLibrary: source === 'library',
      }));
    } catch (e) {
      setBusy(null);
      toastError(e instanceof Error ? e.message : "Couldn't prepare that photo.");
      return;
    }
    const meta = { woNumber: job.number, blob, takenAt: at.toISOString(), lat: pos?.lat ?? null, lng: pos?.lng ?? null, accuracy: pos?.accuracy ?? null, source, label };
    setBusy('Sending…');
    const r = await sendPhoto(meta);
    setBusy(null);
    if (r !== 'offline' && 'url' in r) {
      toastSuccess('Photo sent.');
      await loadSent();
    } else if (r === 'offline') {
      await queuePhoto({ ...meta, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, uid });
      await loadWaiting();
      toastInfo('No signal — photo saved on this phone. It sends as soon as you have signal.');
    } else {
      toastError('error' in r ? r.error : "Couldn't send the photo.");
    }
  };

  // On a project the app asks what the photo is first (Fred, 2026-10-14:
  // "the app asked Mike 'inventory'"); every other job sends it straight away.
  const [pending, setPending] = useState<{ file: File; source: 'camera' | 'library'; preview: string; at: Date } | null>(null);
  const ask = (file: File | undefined, source: 'camera' | 'library') => {
    if (!file) return;
    if (!job.isProject) { void add(file, source); return; }
    setPending({ file, source, preview: URL.createObjectURL(file), at: new Date() });
  };
  const answer = (label: string | null) => {
    if (!pending) return;
    URL.revokeObjectURL(pending.preview);
    setPending(null);
    void add(pending.file, pending.source, label, pending.at);
  };
  const cancel = () => {
    if (pending) URL.revokeObjectURL(pending.preview);
    setPending(null);
  };

  return { sent, waiting, busy, add, flush, pending, ask, answer, cancel };
}

// ── Tools — iScanner's, for techs (Fred, 2026-10-07: "all the above for my
// tech to use", then "edit and sign pdfs everything from iscanner"):
//   Scan a document   paper → PDF, sent to the job (/api/tech/doc, migration 115)
//   Edit & sign a PDF fill in, sign, mark up — a PDF from the phone, a scan, or
//                     one shared with the job's techs (migration 116)
//   Read a code       QR/barcode or a label's words → copy, or the job report
//   Count / Measure   marked-up photos, sent with the job's photos

type JobDoc = { id: string; name: string; kind: string; pages: number | null; created_at: string; mine?: boolean; shared?: boolean };
// Files the office attached on the job (work_orders.doc_urls, migration 125).
type JobFile = { url: string; name: string };
type ToolKey = 'scan' | 'edit' | 'read' | 'count' | 'measure';

function JobTools({ job, canAdd, ph, onNote }: {
  job: WfJob; canAdd: boolean; ph: ReturnType<typeof useJobPhotos>;
  onNote?: (text: string) => Promise<void>;
}) {
  const [tool, setTool] = useState<null | ToolKey>(null);
  // The tools sit in one Tools menu (Fred, 2026-10-18: "hide tools in a menu").
  const [menu, setMenu] = useState(false);
  const [docs, setDocs] = useState<JobDoc[]>([]);
  const [editing, setEditing] = useState<{ file: Blob | null; name: string; kind: string } | null>(null);
  // Any document opened inside the app (components/tools/DocViewer): PDF, Word, Excel or a photo.
  const [viewing, setViewing] = useState<{ url: string; name: string; kind: string; local?: boolean } | null>(null);
  const closeViewer = () => { if (viewing?.local) URL.revokeObjectURL(viewing.url); setViewing(null); };
  const [opening, setOpening] = useState<string | null>(null);
  const loadDocs = useCallback(async () => {
    const { data, error } = await createClient().rpc('wf_tech_job_docs', { p_wo_number: job.number });
    if (!error && Array.isArray(data)) setDocs(data as JobDoc[]);
  }, [job.number]);
  useEffect(() => { void loadDocs(); }, [loadDocs]);
  const [files, setFiles] = useState<JobFile[]>([]);
  // Bumped by the live check when this job's documents change.
  const [filesRev, setFilesRev] = useState(0);
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail === job.number) setFilesRev((n) => n + 1); };
    window.addEventListener('wf-job-files', on);
    return () => window.removeEventListener('wf-job-files', on);
  }, [job.number]);
  useEffect(() => {
    let live = true;
    void createClient().rpc('wf_tech_job_files', { p_wo_number: job.number }).then(({ data, error }) => {
      if (live && !error && Array.isArray(data)) setFiles(data as JobFile[]);
    });
    return () => { live = false; };
  }, [job.number, filesRev]);
  // Tools only on jobs the office turned them on for (Fred, 2026-10-18:
  // "Tools should only apply if admin adds it"; migration 129).
  const [toolsOn, setToolsOn] = useState(false);
  useEffect(() => {
    let live = true;
    void createClient().rpc('wf_tech_tools_on', { p_wo_number: job.number }).then(({ data, error }) => {
      if (live && !error) setToolsOn(data === true);
    });
    return () => { live = false; };
  }, [job.number, filesRev]);
  const showTools = canAdd && toolsOn;
  if (!showTools && docs.length === 0 && files.length === 0) return null;
  const jobLabel = `WO ${job.number}${job.client || job.title ? ` · ${job.client || job.title}` : ''}`;
  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const item = (key: ToolKey, icon: React.ReactNode, label: string, hint: string) => (
    <button type="button" className="wf-tool-item"
      onClick={() => { setMenu(false); if (key === 'edit') setEditing({ file: null, name: '', kind: DOC_KINDS[1] }); else setTool(key); }}>
      {icon}<span><b>{label}</b><small>{hint}</small></span>
    </button>
  );
  const openDoc = async (d: JobDoc) => {
    setOpening(d.id);
    try {
      const res = await fetch(`/api/tech/doc?id=${encodeURIComponent(d.id)}`);
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(j.error ?? "Couldn't open the document.");
        return;
      }
      // Through the viewer, so a form's boxes can be filled in before signing.
      const blob = await res.blob();
      setViewing({ url: URL.createObjectURL(blob), name: /\.pdf$/i.test(d.name) ? d.name : `${d.name}.pdf`, kind: d.kind === 'Work order' ? 'Signed work order' : d.kind, local: true });
    } catch {
      toastError('No signal. Try again when you have signal.');
    } finally { setOpening(null); }
  };
  const shared = docs.filter((d) => d.shared);
  const sent = docs.filter((d) => !d.shared);
  const row = (d: JobDoc) => (
    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--wf-line)', fontSize: 13.5 }}>
      <FileText size={15} color="var(--wf-subtle)" />
      <span style={{ flex: 1, minWidth: 0 }}>{d.name}{!d.name.toLowerCase().includes(d.kind.toLowerCase()) ? <span className="wf-subtle"> · {d.kind}</span> : null}
        <span className="wf-subtle" style={{ display: 'block', fontSize: 12 }}>{d.pages ? `${d.pages} p · ` : ''}{when(d.created_at)}</span>
      </span>
      {canAdd && (
        <button type="button" className={`wf-btn wf-btn-sm ${d.shared ? 'wf-btn-gold' : 'wf-btn-outline'}`} disabled={opening === d.id} onClick={() => void openDoc(d)}>
          {opening === d.id ? 'Opening…' : d.shared ? <><Signature size={14} /> Open &amp; sign</> : 'Open'}
        </button>
      )}
    </div>
  );
  return (<>
    {files.length > 0 && (
      <Section title="Job documents" subtitle="Guides and forms for this job">
        {files.map((f) => {
          // Opened inside the app on every phone and computer (Fred, 2026-10-22); PDF and Word can be filled in and signed.
          const k = docKind(f.name) !== 'other' ? docKind(f.name) : docKind(f.url);
          const fillable = canAdd && (k === 'pdf' || k === 'word');
          return (
            <div key={f.url} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderTop: '1px solid var(--wf-line)', fontSize: 13.5 }}>
              <FileText size={15} color="var(--wf-subtle)" />
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.name}</span>
              <button type="button" className={`wf-btn wf-btn-sm ${fillable ? 'wf-btn-gold' : 'wf-btn-outline'}`}
                onClick={() => setViewing({ url: f.url, name: f.name, kind: 'Signed document' })}>
                {fillable ? <><Signature size={14} /> Open &amp; fill in</> : 'Open'}
              </button>
            </div>
          );
        })}
      </Section>
    )}
    {(showTools || docs.length > 0) && (
    <Section title={showTools ? 'Your documents' : 'Documents to sign'} subtitle={showTools ? 'Scans and signed PDFs for this job' : undefined}
      right={showTools && (
        <button type="button" className="wf-btn wf-btn-outline wf-btn-sm" aria-expanded={menu} aria-controls={`wf-tools-${job.number}`}
          onClick={() => setMenu((v) => !v)}>
          <Wrench size={15} /> Tools <ChevronDown size={15} style={{ transform: menu ? 'rotate(180deg)' : undefined }} />
        </button>
      )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {showTools && menu && (
          <div id={`wf-tools-${job.number}`} className="wf-tool-menu" role="group" aria-label="Tools">
            {item('scan', <ScanLine size={18} />, 'Scan', 'A paper document, as a PDF for the job')}
            {item('edit', <Signature size={18} />, 'Sign a PDF', 'Fill in and sign a PDF from your phone')}
            {item('read', <ScanBarcode size={18} />, 'Read a code', 'A code, serial number or label, into your report')}
            {item('count', <Hash size={18} />, 'Count', 'Tap each port, camera or drop on a photo')}
            {item('measure', <Ruler size={18} />, 'Measure', 'Measure something on a photo')}
          </div>
        )}
        {showTools && shared.length === 0 && sent.length === 0 && (
          <div className="wf-subtle" style={{ fontSize: 13 }}>Nothing yet. Scan a paper, sign a PDF, read a code, count or measure from Tools.</div>
        )}
        {shared.length > 0 && (
          <div>
            <div className="wf-label" style={{ marginBottom: 4 }}>To fill in or sign</div>
            {shared.map(row)}
          </div>
        )}
        {sent.length > 0 && (
          <div>
            <div className="wf-label" style={{ marginBottom: 4 }}>Documents you sent</div>
            {sent.map(row)}
          </div>
        )}
      </div>
    </Section>
    )}
    {tool === 'scan' && (
      <DocScanner woNumber={job.number} jobLabel={jobLabel}
        onClose={() => setTool(null)} onSent={() => void loadDocs()}
        onEdit={(file, name, kind) => { setTool(null); setEditing({ file, name, kind }); }} />
    )}
    {tool === 'read' && <ReadTool onClose={() => setTool(null)} onNote={onNote} />}
    {(tool === 'count' || tool === 'measure') && (
      <PhotoMarkup mode={tool} onClose={() => setTool(null)}
        onSave={async (file, source) => { const what = tool === 'count' ? 'Count' : 'Measure'; setTool(null); await ph.add(file, source, what); }} />
    )}
    {viewing && (
      <DocViewer url={viewing.url} name={viewing.name} onClose={closeViewer}
        onSign={canAdd ? (pdf, name) => { const kind = viewing.kind; closeViewer(); setEditing({ file: pdf, name: signedName(name), kind }); } : undefined} />
    )}
    {editing && (
      <PdfEditor file={editing.file} name={editing.name} heading={jobLabel}
        send={{ label: 'Send to the job', kinds: [...DOC_KINDS], defaultKind: editing.kind }}
        onSend={async (r) => {
          const out = await sendTechDoc(job.number, r.blob, r.name, r.kind, r.pages);
          if (!out.ok) { toastError(out.error); return false; }
          toastSuccess(`${r.name} sent.`);
          void loadDocs();
          return true;
        }}
        onClose={() => setEditing(null)} />
    )}
  </>);
}

/** The client's links for this job (migration 130; Fred, 2026-10-18: "I just
 *  want to link that link into the work order"). Nothing shows without any. */
function ClientLinksCard({ number, siteLinks, checkoutHref }: {
  number: string; siteLinks: SiteLinks;
  /** The checkout form filled in with today's times. */
  checkoutHref: () => string | null;
}) {
  const [links, setLinks] = useState<string[]>([]);
  const tick = useReloadTick();
  useEffect(() => {
    let live = true;
    void createClient().rpc('wf_tech_job_links', { p_wo_number: number }).then(({ data, error }) => {
      if (live && !error && Array.isArray(data)) setLinks(data.filter((l): l is string => typeof l === 'string'));
    });
    return () => { live = false; };
  }, [number, tick]);
  if (links.length === 0) return null;
  return (
    <section className="fs-card fs-form">
      <h3>Client links</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {links.map((l) => (
          <a key={l} className="wf-btn wf-btn-outline" href={l === siteLinks.checkout ? checkoutHref() ?? l : l} target="_blank" rel="noopener noreferrer"
            style={{ justifyContent: 'space-between', minWidth: 0 }}>
            <span style={{ minWidth: 0, textAlign: 'left' }}>
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{linkLabel(l)}</span>
              {(l === siteLinks.checkin || l === siteLinks.checkout) && (
                <span className="fs-muted" style={{ display: 'block', fontSize: 12, fontWeight: 400 }}>
                  {l === siteLinks.checkin ? 'Join when you check in on site' : 'Fill in when you check out each day'}
                </span>
              )}
            </span>
            <FsIcon name="arrow" size={16} />
          </a>
        ))}
      </div>
    </section>
  );
}

/** The job's link for on site and for check-out (migration 133). Nothing until it has loaded. */
function useSiteLinks(number: string): SiteLinks {
  const [links, setLinks] = useState<SiteLinks>({});
  const tick = useReloadTick();
  useEffect(() => {
    let live = true;
    void createClient().rpc('wf_tech_site_links', { p_wo_number: number }).then(({ data, error }) => {
      if (live && !error) setLinks(parseSiteLinks(data));
    });
    return () => { live = false; };
  }, [number, tick]);
  return links;
}

/**
 * Ticks every minute while the app is open, and again when the tech comes back
 * to it, so links the office adds to a job show up without leaving the job
 * (Fred, 2026-10-19: Raja's iPhone loaded the links at 8:00, before two more
 * were added).
 */
function useReloadTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState === 'visible') setTick((t) => t + 1); };
    const timer = window.setInterval(bump, 60_000);
    document.addEventListener('visibilitychange', bump);
    window.addEventListener('focus', bump);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', bump);
      window.removeEventListener('focus', bump);
    };
  }, []);
  return tick;
}

const isTeams = (l: string) => /^https:\/\/([a-z0-9-]+\.)*teams\.(microsoft|live)\.com\//i.test(l);

/** On site: open the client's link for the day, e.g. their Teams meeting. Nothing shows when the job has none. */
function OnSiteLinkDialog({ number, onClose }: { number: string; onClose: () => void }) {
  const links = useSiteLinks(number);
  if (!links.checkin) return null;
  const teams = isTeams(links.checkin);
  return (
    <Dialog title="You're on site" onClose={onClose}
      footer={<button className="wf-btn wf-btn-ghost" onClick={onClose}>Done</button>}>
      <p style={{ marginTop: 0 }}>
        {teams ? 'Join the client\u2019s Teams meeting now and stay on it until you leave the site.' : 'Open the client\u2019s link for today.'}
      </p>
      <a className="wf-btn wf-btn-navy" href={links.checkin} target="_blank" rel="noopener noreferrer" onClick={onClose}
        style={{ width: '100%', justifyContent: 'center' }}>
        {teams ? 'Join the Teams meeting' : 'Open the link'}
      </a>
    </Dialog>
  );
}

/** Off site: the client's checkout form, filled in with this job and today's times. */
function CheckoutLinkDialog({ href, on, off, onClose }: { href: string | null; on: string | null; off: string; onClose: () => void }) {
  if (!href) return null;
  const tz = 'America/New_York';
  return (
    <Dialog title="Check out with the client" onClose={onClose}
      footer={<button className="wf-btn wf-btn-ghost" onClick={onClose}>Done</button>}>
      <p style={{ marginTop: 0 }}>
        Fill in the client&apos;s checkout form for today. The job and your times are already in it
        {on ? `: on site ${clock24(on, tz)}, off site ${clock24(off, tz)}` : `: off site ${clock24(off, tz)}`}.
        Pick your role, add any issues, and submit it.
      </p>
      <a className="wf-btn wf-btn-navy" href={href} target="_blank" rel="noopener noreferrer" onClick={onClose}
        style={{ width: '100%', justifyContent: 'center' }}>
        Open the checkout form
      </a>
    </Dialog>
  );
}

function JobPhotos({ canAdd, ph }: { canAdd: boolean; ph: ReturnType<typeof useJobPhotos> }) {
  const { sent, waiting, busy, ask, flush } = ph;
  const pick = (source: 'camera' | 'library', icon: React.ReactNode, label: string, primary: boolean) => (
    <label className={`wf-btn ${primary ? 'wf-btn-gold' : 'wf-btn-outline'}`} style={{ flex: '1 1 150px', opacity: busy ? 0.6 : 1, pointerEvents: busy ? 'none' : 'auto' }}>
      {icon} {label}
      <input
        type="file" accept="image/*" {...(source === 'camera' ? { capture: 'environment' as const } : {})}
        style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; ask(f, source); }}
      />
    </label>
  );

  const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    // Fred, 2026-10-02: the stamp is just done — the screen doesn't talk about it.
    <Section title="Photos">
      {canAdd && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: sent.length || waiting.length || busy ? 12 : 0 }}>
          {pick('camera', <Camera size={17} />, 'Take photo', true)}
          {pick('library', <ImagePlus size={17} />, 'Add from phone', false)}
        </div>
      )}
      {busy && <div className="wf-subtle" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><RefreshCw size={15} className="spin" /> {busy}</div>}
      {waiting.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <CloudOff size={15} color="var(--wf-warning)" />
            <span style={{ flex: 1, fontWeight: 600, color: 'var(--wf-warning)' }}>{waiting.length} waiting to send</span>
            <button className="wf-btn wf-btn-outline wf-btn-sm" onClick={() => void flush()}>Send now</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
            {waiting.map(({ p, url }) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.id} src={url} alt={`Waiting photo, ${when(p.takenAt)}`} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10, opacity: 0.75 }} />
            ))}
          </div>
        </div>
      )}
      {sent.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8 }}>
          {sent.map((p) => (
            <div key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={`Job photo, ${when(p.taken_at)}`} loading="lazy" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 10 }} />
              </a>
              <div style={{ fontSize: 11, color: 'var(--wf-subtle)', marginTop: 2 }}>
                {when(p.taken_at)}
                {p.lat != null && p.lng != null && <> · <a href={mapLink(p.lat, p.lng)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--wf-navy)' }}>map</a></>}
              </div>
            </div>
          ))}
        </div>
      ) : !waiting.length && !busy && (
        <div className="wf-subtle" style={{ fontSize: 13 }}>{canAdd ? 'No photos yet. Take before and after shots of your work.' : 'No photos on this job.'}</div>
      )}
    </Section>
  );
}

/** The job's thread with the office — the same one Fred sees on the job in WorkFlow. */
function JobMessages({ number, talk, keep }: {
  number: string; talk?: ReturnType<typeof useSiteTalk>;
  /** The unsent message, kept by the job screen so switching tabs doesn't lose it. */
  keep?: [string, (v: string) => void];
}) {
  const [own, setOwn] = useState<TechMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const local = useState('');
  const [draft, setDraft] = keep ?? local;
  const [sending, setSending] = useState(false);
  // On a project: to FAJ (private, as before), a project manager, or everyone
  // on the project sheet (Fred, 2026-10-14: "open message, select the PM").
  const [to, setTo] = useState('FAJ');
  const contacts = talk?.contacts ?? [];
  useEffect(() => {
    const pm = contacts.find((c) => c.role === 'pm');
    if (pm) setTo((t) => (t === 'FAJ' ? pm.name : t));
  }, [contacts]);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (talk) { await talk.load(); return; }
    try { setOwn(await fetchTechMessages(number)); setFailed(false); }
    catch { setFailed(true); }
  }, [number, talk]);
  useEffect(() => { void load(); }, [load]);
  // Opening the thread means they've seen it (migration 123).
  useEffect(() => {
    if (talk) { void talk.markRead(); return; }
    void createClient().rpc('wf_tech_mark_read', { p_wo_number: number });
  }, [number]); // eslint-disable-line react-hooks/exhaustive-deps
  const messages = talk ? talk.msgs : own;
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages?.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      if (talk && to !== 'FAJ') {
        const err = await sendSiteMessage(number, { body, to });
        if (err) toastError(err); else { setDraft(''); await load(); }
      } else if (await sendTechMessage(number, body)) { setDraft(''); await load(); }
      else toastError("Couldn't send that message.");
    } catch (e) {
      toastError(isNoSignal(e) ? 'No signal — messages need signal to send. Your text is still in the box.' : "Couldn't send that message.");
    }
    setSending(false);
  };
  const kindLine = (m: TechMessage) => m.kind === 'issue' ? `No access${m.reason ? `: ${m.reason}` : ''}`
    : m.kind === 'resolved' ? 'Got access' : m.kind === 'question' ? 'Question' : m.kind === 'answer' ? 'Answer' : m.kind === 'note' ? 'Note on the sheet' : '';

  return (
    <Section title="Messages" subtitle="With FAJ, about this job">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '46vh', overflowY: 'auto', marginBottom: 10 }}>
        {failed ? <div className="wf-subtle">Messages need signal. Try again when you have it.</div>
          : messages === null ? <div className="wf-subtle">Loading…</div>
          : messages.length === 0 ? <div className="wf-subtle">No messages yet. Ask us anything about this job.</div>
          : messages.map((m) => {
            const mine = m.mine ?? m.sender_role === 'contractor';
            const what = kindLine(m);
            const toLine = mine && m.on_sheet ? (m.to_name ? `to ${m.to_name}` : 'to everyone on the sheet') : '';
            return (
              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth: '84%', padding: '9px 13px', borderRadius: 14,
                  background: mine ? 'var(--wf-navy)' : '#F1EEE6', color: mine ? '#fff' : 'var(--wf-text)',
                }}>
                  {!mine && <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--wf-gold-dark)' }}>{m.sender_name}{m.sender_role === 'client' ? ' · project sheet' : ''}</div>}
                  {(what || toLine) && <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.8 }}>{[what, toLine].filter(Boolean).join(' · ')}</div>}
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
      {talk && (
        <select className="wf-input" style={{ fontSize: 16, marginBottom: 8 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="Send to">
          {contacts.map((c) => <option key={c.name} value={c.name}>To {c.name}{c.role === 'pm' ? ' (project manager)' : ''}</option>)}
          <option value="Everyone">To everyone on the project sheet</option>
          <option value="FAJ">To FAJ only</option>
        </select>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea className="wf-input" rows={2} value={draft} placeholder="Write a message…" style={{ flex: 1, resize: 'none' }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
        <button className="wf-btn wf-btn-navy" onClick={send} disabled={sending || !draft.trim()} aria-label="Send"><Send size={17} /></button>
      </div>
    </Section>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

/**
 * Who to call if something happens on a job (Fred, 2026-10-06: "an emergency
 * number"). The tech fills it in; Fred sees it on their profile and can set it
 * too. Also shows when they started, if Fred has entered it.
 */
function EmergencyCard({ profile, onSaved }: { profile: TechProfile; onSaved: (p: TechProfile) => void }) {
  const [name, setName] = useState(profile.emergency_name ?? '');
  const [phone, setPhone] = useState(profile.emergency_phone ?? '');
  const [relation, setRelation] = useState(profile.emergency_relation ?? '');
  const [saving, setSaving] = useState(false);
  const dirty = name !== (profile.emergency_name ?? '') || phone !== (profile.emergency_phone ?? '') || relation !== (profile.emergency_relation ?? '');
  const missing = !profile.emergency_phone;

  const save = async () => {
    if (name.trim() && !phone.trim()) { toastError('Add their phone number too.'); return; }
    setSaving(true);
    try {
      await saveTechEmergency({ name, phone, relation });
      onSaved({ ...profile, emergency_name: name.trim() || null, emergency_phone: phone.trim() || null, emergency_relation: relation.trim() || null });
      toastSuccess('Saved. We have your emergency contact.');
    } catch (e) {
      toastError(isNoSignal(e) ? 'No signal — try saving again when you have it.' : "Couldn't save your emergency contact.");
    }
    setSaving(false);
  };

  const box = (label: string, value: string, set: (v: string) => void, placeholder: string, mode?: 'tel') => (
    <label style={{ display: 'block' }}>
      <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{label}</span>
      <input className="wf-input" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} inputMode={mode} type={mode === 'tel' ? 'tel' : 'text'} />
    </label>
  );

  return (
    <Section title="Emergency contact" subtitle="Who we should call if something happens on a job">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {missing && (
          <div style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(198,40,40,0.08)', color: 'var(--wf-danger)', fontSize: 13, fontWeight: 600 }}>
            Please add someone we can call in an emergency.
          </div>
        )}
        {box('Name', name, setName, 'Who to call')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {box('Phone', phone, setPhone, '(555) 000-0000', 'tel')}
          {box('Relationship', relation, setRelation, 'Wife, brother…')}
        </div>
        <div className="save-bar"><button className="wf-btn wf-btn-navy" onClick={save} disabled={saving || !dirty}><Save size={16} /> {saving ? 'Saving…' : 'Save emergency contact'}</button></div>
        {profile.hire_date && <div className="wf-subtle" style={{ fontSize: 12 }}>With FAJ Solutions since {fmtDate(profile.hire_date)}.</div>}
      </div>
    </Section>
  );
}

function ProfileTab({ profile, portalToken, onSaved, onFiled, onSignOut, wide, onWide }: {
  profile: TechProfile; portalToken: string | null; onSaved: (p: TechProfile) => void; onFiled: () => void; onSignOut: () => void;
  /** Wide (desktop) view on this device; phone view otherwise. */
  wide: boolean; onWide: (wide: boolean) => void;
}) {
  const [formsOpen, setFormsOpen] = useState(false);
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
      toastSuccess('Saved. We have your new details.');
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
      <UsernameCard />
      <Section title="Screen" subtitle="How the app is laid out on this device">
        <div className="wf-filters" role="group" aria-label="Screen layout">
          <button className="wf-filter" aria-pressed={!wide} onClick={() => onWide(false)}>Phone view</button>
          <button className="wf-filter" aria-pressed={wide} onClick={() => onWide(true)}>Wide view</button>
        </div>
        <p className="wf-subtle" style={{ margin: '8px 0 0', fontSize: 12.5 }}>
          Phone view is the default. Wide view uses the whole screen on a tablet or computer.
        </p>
      </Section>
      <Section title="Change password" subtitle="Your current password, then the new one twice">
        <ChangePasswordForm />
      </Section>
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
          <div className="save-bar"><button className="wf-btn wf-btn-navy" onClick={save} disabled={saving}><Save size={16} /> {saving ? 'Saving…' : 'Save details'}</button></div>
        </div>
      </Section>
      <EmergencyCard profile={profile} onSaved={onSaved} />
      <Section title="Paperwork">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Check ok={!!profile.w9_received} label="W-9 on file" detail={profile.w9_submitted_at ? `Submitted ${fmtDate(profile.w9_submitted_at)}` : 'Not received yet'} />
          <Check ok={!!profile.contract_signed_at} label="Contractor agreement" detail={profile.contract_signed_at ? `Signed ${fmtDate(profile.contract_signed_at)}` : 'Not signed yet'} />
        </div>
        <div className="wf-subtle" style={{ fontSize: 12, marginTop: 12 }}>
          Your W-9 has your Social Security or tax number, so it is filed through the secure W-9 page — never kept on this phone.
          You are paid by direct deposit through QuickBooks, which collects your bank details itself.
        </div>
        <button className="wf-btn wf-btn-outline wf-btn-sm" style={{ marginTop: 12 }} onClick={() => setFormsOpen((v) => !v)} aria-expanded={formsOpen}>
          <FileText size={15} /> {formsOpen ? 'Hide my W-9 & agreement' : 'Open my W-9 & agreement'}
        </button>
        {formsOpen && (
          <div style={{ marginTop: 12 }}>
            {portalToken ? (
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
                onFiled={onFiled}
              />
            ) : (
              <Empty title="Couldn't open your paperwork" message="It needs signal. Try again, or sign out and back in." />
            )}
          </div>
        )}
      </Section>
      <button className="wf-btn wf-btn-outline" onClick={onSignOut} style={{ alignSelf: 'flex-start' }}><LogOut size={16} /> Sign out</button>
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

/**
 * Pick or change the username used to sign in (migration-099). Logins made
 * before usernames existed sign in by email until one is picked here.
 */
function UsernameCard() {
  const [current, setCurrent] = useState<string | null | undefined>(undefined);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    createClient().rpc('my_username').then(({ data, error }) => {
      if (error) { setCurrent(null); return; }
      setCurrent((data as string | null) ?? null);
      setValue((data as string | null) ?? '');
    });
  }, []);

  const save = async () => {
    const problem = usernameProblem(value);
    if (problem) { toastError(problem); return; }
    setSaving(true);
    const { data, error } = await createClient().rpc('set_my_username', { p_username: value });
    setSaving(false);
    const r = (data ?? {}) as { ok?: boolean; reason?: string; username?: string };
    if (error) { toastError(isNoSignal(error) ? 'No signal — try again when you have it.' : "Couldn't save your username."); return; }
    if (!r.ok) {
      toastError(r.reason === 'taken' ? 'That username is taken. Try another.' : usernameProblem(value) ?? "Couldn't save your username.");
      return;
    }
    setCurrent(r.username ?? value);
    setValue(r.username ?? value);
    toastSuccess(`Saved. Sign in with "${r.username}" from now on.`);
  };

  return (
    <Section title="Your login" subtitle={current ? `You sign in as ${current}` : 'Pick a username to sign in with'}>
      <label style={{ display: 'block' }}>
        <span className="wf-label" style={{ display: 'block', marginBottom: 4 }}>Username</span>
        <input className="wf-input" value={value} onChange={(e) => setValue(e.target.value)}
          autoCapitalize="none" spellCheck={false} placeholder="e.g. jere.jones" />
      </label>
      <div className="wf-subtle" style={{ fontSize: 12, margin: '4px 0 10px' }}>{USERNAME_RULE}. You can still sign in with your email too.</div>
      <div className="save-bar">
        <button className="wf-btn wf-btn-navy" onClick={save} disabled={saving || current === undefined || value.trim().toLowerCase() === (current ?? '')}>
          <Save size={16} /> {saving ? 'Saving…' : current ? 'Change username' : 'Save username'}
        </button>
      </div>
    </Section>
  );
}
