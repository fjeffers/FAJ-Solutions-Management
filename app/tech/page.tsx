'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchTechProfile, fetchTechJobs, fetchTechPayments, fetchTechSummary,
  fetchTechUnread, fetchTechDmUnread, fetchTechPortalToken, fetchTechOpenJobs, saveTechProfile,
  splitJobs, paymentsByYear, jobLocation, jobPayLine,
} from '@/lib/tech-portal';
import TechChat from '@/components/TechChat';
import TechInstall from '@/components/TechInstall';
import TechOpenWork from '@/components/TechOpenWork';
import TechJobActions from '@/components/TechJobActions';
import TechCrew from '@/components/TechCrew';
import { fetchCrewBoard } from '@/lib/crew-portal';
import PortalDocuments from '@/app/portal/[token]/PortalDocuments';
import type { TechJob, TechOpenJob, TechPayment, TechProfile, TechSummary } from '@/lib/types';
import { fmtMoney, fmtDate } from '@/lib/utils';
import {
  HardHat, LogOut, Briefcase, Wallet, User, MapPin, Calendar, Clock,
  CheckCircle2, Save, MessageSquare, ChevronDown, FileWarning, FileText, Inbox, Users,
} from 'lucide-react';

type Tab = 'jobs' | 'open' | 'pay' | 'chat' | 'profile' | 'paperwork' | 'crew';

export default function TechPortalPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  // The installed app's "My pay" shortcut opens straight on that tab, so it is
  // a real shortcut rather than one that lands on the same screen as the icon.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === 'undefined') return 'jobs';
    const t = new URLSearchParams(window.location.search).get('tab');
    return (['jobs', 'open', 'pay', 'chat', 'profile', 'paperwork', 'crew'] as const)
      .includes(t as Tab) ? (t as Tab) : 'jobs';
  });

  const [profile, setProfile] = useState<TechProfile | null>(null);
  const [jobs, setJobs] = useState<TechJob[]>([]);
  const [payments, setPayments] = useState<TechPayment[]>([]);
  const [summary, setSummary] = useState<TechSummary | null>(null);
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [openJobs, setOpenJobs] = useState<TechOpenJob[]>([]);
  // Crew projects (migration-087): only leads on one see the menu item.
  const [onCrew, setOnCrew] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/tech/login?classic=1'); return; }

      try {
        const me = await fetchTechProfile();
        // Signed in but not a linked tech — Fred's own account lands here too.
        if (!me) { setDenied(true); setLoading(false); return; }
        const [j, p, s, u, dmU, tok, open] = await Promise.all([
          fetchTechJobs(), fetchTechPayments(), fetchTechSummary(), fetchTechUnread(),
          fetchTechDmUnread(), fetchTechPortalToken(), fetchTechOpenJobs(),
        ]);
        setProfile(me); setJobs(j); setPayments(p); setSummary(s); setUnread(u + dmU);
        setPortalToken(tok); setOpenJobs(open);
        // A crew lookup failing must not lock a tech out of their normal jobs.
        fetchCrewBoard().then((b) => setOnCrew(b.length > 0)).catch(() => {});
      } catch {
        setDenied(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Accepting moves a job from Open Work into My Jobs, so both lists reload.
  const reloadJobs = async () => {
    try {
      const [mine, open] = await Promise.all([fetchTechJobs(), fetchTechOpenJobs()]);
      setJobs(mine); setOpenJobs(open);
    } catch { /* the toast from the action already said what happened */ }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/tech/login?classic=1');
  };

  // tech_my_jobs returns live work only (migration-083); splitJobs still runs
  // so an older cached response cannot slip a finished job onto the screen.
  const { active } = useMemo(() => splitJobs(jobs), [jobs]);

  // What is still unfiled. Fred cannot pay a tech with no W-9 on file, so this
  // is worth a badge rather than a page they have to think to visit.
  const paperworkDue =
    (profile && !profile.w9_received ? 1 : 0) +
    (profile && !profile.contract_signed_at ? 1 : 0);

  if (loading) {
    return (
      <Centered>
        <HardHat size={26} color="var(--gold)" style={{ marginBottom: 12 }} />
        <div className="serif" style={{ fontSize: 20, color: 'var(--teal)' }}>Loading your account…</div>
      </Centered>
    );
  }

  if (denied) {
    return (
      <Centered>
        <div className="glass card" style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
          <HardHat size={26} color="#bbb" style={{ marginBottom: 10 }} />
          <div className="serif" style={{ fontSize: 22, marginBottom: 8 }}>Not a tech account</div>
          <p style={{ color: '#666', fontSize: 13, lineHeight: 1.6, margin: '0 0 18px' }}>
            You&apos;re signed in, but this login isn&apos;t linked to a contractor record.
            If you&apos;re a tech, ask Fred to add your email to your contractor profile.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <a className="btn btn-ghost" href="/">Owner app</a>
            <button className="btn btn-primary" onClick={signOut}>Sign out</button>
          </div>
        </div>
      </Centered>
    );
  }

  return (
    <div style={{ minHeight: '100vh', paddingBottom: 40 }}>
      {/* Header — stacks on a phone, spreads on a laptop */}
      <header style={{
        background: 'linear-gradient(135deg, #0D7377 0%, #0a5a5d 100%)', color: 'white',
        padding: '18px 16px', position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <HardHat size={15} color="var(--gold-light)" />
              <span className="display" style={{ fontSize: 10, color: 'var(--gold-light)', fontWeight: 700, letterSpacing: 1.5 }}>FAJ SOLUTIONS</span>
            </div>
            <div className="serif" style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.name}
            </div>
          </div>
          {/* One menu rather than a row of buttons: on a phone that is the
              difference between reachable and cramped. */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu" aria-expanded={menuOpen}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer',
                borderRadius: 999, padding: '8px 13px', display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 12, fontWeight: 700,
              }}
            >
              <span style={{
                width: 24, height: 24, borderRadius: '50%', background: 'rgba(255,255,255,0.22)',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800,
              }}>{initials(profile?.name)}</span>
              Menu
              {unread > 0 && (
                <span style={{ background: 'var(--gold)', color: '#3b2f10', borderRadius: 999, fontSize: 9, fontWeight: 800, padding: '1px 6px' }}>
                  {unread}
                </span>
              )}
              <ChevronDown size={14} style={{ transform: menuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>

            {menuOpen && (
              <>
                <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
                <div
                  role="menu"
                  style={{
                    position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 31,
                    minWidth: 212, background: 'white', borderRadius: 12,
                    boxShadow: '0 12px 40px rgba(0,0,0,0.18)', overflow: 'hidden', color: '#333',
                  }}
                >
                  <div style={{ padding: '11px 14px', borderBottom: '1px solid #f0ede6' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{profile?.name}</div>
                    {profile?.email && <div style={{ fontSize: 11, color: '#999' }}>{profile.email}</div>}
                  </div>
                  <MenuItem icon={<Briefcase size={15} />} label="My Jobs" badge={jobs.length}
                    onClick={() => { setTab('jobs'); setMenuOpen(false); }} />
                  {onCrew && (
                    <MenuItem icon={<Users size={15} />} label="Crew Project"
                      onClick={() => { setTab('crew'); setMenuOpen(false); }} />
                  )}
                  <MenuItem icon={<Inbox size={15} />} label="Needs Your Answer" badge={openJobs.length}
                    attention={openJobs.length > 0}
                    onClick={() => { setTab('open'); setMenuOpen(false); }} />
                  <MenuItem icon={<Wallet size={15} />} label="Pay History" badge={payments.length}
                    onClick={() => { setTab('pay'); setMenuOpen(false); }} />
                  <MenuItem icon={<MessageSquare size={15} />} label="Chat" badge={unread || undefined}
                    onClick={() => { setTab('chat'); setMenuOpen(false); }} />
                  <MenuItem icon={<User size={15} />} label="Profile"
                    onClick={() => { setTab('profile'); setMenuOpen(false); }} />
                  <MenuItem icon={<FileText size={15} />} label="W-9 & Agreement"
                    badge={paperworkDue} attention={paperworkDue > 0}
                    onClick={() => { setTab('paperwork'); setMenuOpen(false); }} />
                  <div style={{ borderTop: '1px solid #f0ede6' }}>
                    <MenuItem icon={<LogOut size={15} />} label="Sign out" danger onClick={signOut} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '18px 16px 0' }}>
        {/* Money up top: what they were paid, never what the job billed. */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
            <Stat label="Paid this year" value={fmtMoney(summary.paid_this_year)} accent />
            <Stat label="Paid all time" value={fmtMoney(summary.paid_all_time)} />
            <Stat label="Open jobs" value={String(summary.jobs_open)} />
            <Stat label="Jobs worked" value={String(summary.jobs_total)} />
            {openJobs.length > 0 && (
              <button
                onClick={() => setTab('open')}
                className="glass card"
                style={{ padding: '12px 14px', textAlign: 'left', cursor: 'pointer', border: '1px solid rgba(13,115,119,0.25)' }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#999', textTransform: 'uppercase' }}>To accept</div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--teal)', marginTop: 3 }}>{openJobs.length}</div>
              </button>
            )}
          </div>
        )}

        <TechInstall />

        {/* A crew lead's daily errand — hours and receipts — one tap from home. */}
        {onCrew && tab !== 'crew' && (
          <button
            onClick={() => setTab('crew')}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 11,
              background: 'rgba(13,115,119,0.07)', border: '1px solid rgba(13,115,119,0.25)',
              borderRadius: 12, padding: '12px 14px',
            }}
          >
            <Users size={18} color="var(--teal)" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--teal)' }}>Crew project</div>
              <div style={{ fontSize: 11.5, color: '#666', marginTop: 2 }}>
                Log today&apos;s hours, add receipts, pick sites, message the crew.
              </div>
            </div>
          </button>
        )}

        {/* Unfiled paperwork is money that cannot be paid out — say so once,
            at the top, rather than hiding it behind a menu item. */}
        {paperworkDue > 0 && tab !== 'paperwork' && (
          <button
            onClick={() => setTab('paperwork')}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 11,
              background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 12, padding: '12px 14px',
            }}
          >
            <FileWarning size={18} color="#b45309" style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#92400e' }}>
                {profile && !profile.w9_received && !profile.contract_signed_at
                  ? 'Your W-9 and agreement are outstanding'
                  : profile && !profile.w9_received
                    ? 'Your W-9 is outstanding'
                    : 'Your contractor agreement is unsigned'}
              </div>
              <div style={{ fontSize: 11.5, color: '#a16207', marginTop: 2 }}>
                Tap to complete it — takes a minute.
              </div>
            </div>
          </button>
        )}

        <h2 className="serif" style={{ fontSize: 24, fontWeight: 600, margin: '0 0 14px' }}>
          {tab === 'jobs' ? 'My Jobs'
            : tab === 'pay' ? 'Pay History'
            : tab === 'open' ? 'Needs Your Answer'
            : tab === 'chat' ? 'Chat'
            : tab === 'paperwork' ? 'W-9 & Agreement'
            : tab === 'crew' ? 'Crew Project'
            : 'Profile'}
        </h2>

        {tab === 'jobs' && <JobsTab active={active} onChanged={reloadJobs} onSeePay={() => setTab('pay')} />}
        {tab === 'open' && <TechOpenWork jobs={openJobs} onChanged={reloadJobs} />}
        {tab === 'crew' && <TechCrew />}
        {tab === 'pay' && <PayTab payments={payments} />}
        {tab === 'chat' && (
          <TechChat
            jobs={active}
            onRead={async () => {
              const [u, dmU] = await Promise.all([fetchTechUnread(), fetchTechDmUnread()]);
              setUnread(u + dmU);
            }}
          />
        )}
        {tab === 'profile' && profile && <ProfileTab profile={profile} onSaved={(p) => setProfile(p)} />}
        {tab === 'paperwork' && profile && (
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
            <Empty>Couldn&apos;t open your paperwork. Try signing out and back in.</Empty>
          )
        )}
      </div>
    </div>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────

/**
 * Live work only (migration-083).
 *
 * A finished or closed job leaves this list entirely rather than piling up
 * underneath it. What a tech worked and was paid for is not lost — it is in
 * Pay History, which names the work order, the site and the amount for every
 * payout. This screen answers one question: what is still mine to do.
 */
function JobsTab({ active, onChanged, onSeePay }: {
  active: TechJob[]; onChanged: () => void; onSeePay: () => void;
}) {
  return (
    <>
      <SectionHead>Your work{active.length > 0 && ` (${active.length})`}</SectionHead>
      {active.length === 0 ? (
        <Empty>Nothing on your plate right now.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {active.map((j) => <JobCard key={j.id} job={j} onChanged={onChanged} />)}
        </div>
      )}

      <button
        onClick={onSeePay}
        style={{
          marginTop: 18, width: '100%', padding: '11px 0', borderRadius: 10,
          border: '1px solid rgba(13,115,119,0.25)', background: 'rgba(13,115,119,0.06)',
          color: 'var(--teal)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          fontFamily: 'Lato, sans-serif',
        }}
      >
        Finished jobs and what you were paid →
      </button>
    </>
  );
}

function JobCard({ job, onChanged }: { job: TechJob; onChanged: () => void }) {
  const where = jobLocation(job);
  const when = job.scheduled_date || job.start_date;
  const payLine = jobPayLine(job);
  const isLive = job.is_active ?? !job.is_closed;
  return (
    <div className="glass card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--teal)' }}>WO {job.wo_number}</span>
            <StatusPill closed={job.is_closed} done={!isLive} status={job.wo_status} />
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>
            {job.title || job.customer_name || 'Work order'}
          </div>
          {job.customer_name && job.title && (
            <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>{job.customer_name}</div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 9, fontSize: 12, color: '#777' }}>
        {where && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><MapPin size={12} />{where}</span>}
        {when && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Calendar size={12} />{fmtDate(when)}</span>}
        {job.hours_worked != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={12} />{job.hours_worked} hr</span>
        )}
      </div>

      {job.closeout_notes && (
        <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid #eee', fontSize: 12, color: '#666', lineHeight: 1.5 }}>
          {job.closeout_notes}
        </div>
      )}

      {payLine && (
        <div style={{
          marginTop: 9, display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          background: 'rgba(4,120,87,0.08)', color: '#047857',
        }}>
          <Wallet size={13} /> {payLine}
        </div>
      )}

      <TechJobActions job={job} onChanged={onChanged} />
    </div>
  );
}

/**
 * How the job reads to the tech. `done` covers the middle state: they have
 * handed it back and it is finished as far as they are concerned, even though
 * the office has not closed or archived it yet. Showing that in the same blue
 * as live work made a finished job look like it never saved.
 */
function StatusPill({ closed, done, status }: {
  closed: boolean; done?: boolean; status: string | null;
}) {
  const s = closed
    ? { label: status === 'Paid' ? 'Paid' : 'Closed', color: '#047857', bg: 'rgba(16,185,129,0.12)' }
    : done
      ? { label: 'Done', color: '#047857', bg: 'rgba(16,185,129,0.12)' }
      : { label: status || 'Open', color: '#1D4ED8', bg: 'rgba(59,130,246,0.12)' };
  return (
    <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ── Pay ─────────────────────────────────────────────────────────────────────

function PayTab({ payments }: { payments: TechPayment[] }) {
  const years = useMemo(() => paymentsByYear(payments), [payments]);

  if (payments.length === 0) {
    return <Empty>No payments recorded yet.</Empty>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      {years.map((y) => (
        <div key={y.year}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
            <SectionHead noMargin>{y.year}</SectionHead>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--teal)' }}>{fmtMoney(y.total)}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {y.payments.map((p) => (
              <div key={p.id} className="glass card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3 }}>
                    {p.wo_title || p.wo_site || (p.wo_number ? `WO ${p.wo_number}` : 'Payment')}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2, display: 'flex', flexWrap: 'wrap', gap: '2px 8px' }}>
                    {p.payment_date && <span>{fmtDate(p.payment_date)}</span>}
                    {p.wo_number && <span>· WO {p.wo_number}</span>}
                    {p.method && <span>· {p.method}</span>}
                  </div>
                  {p.notes && <div style={{ fontSize: 11, color: '#999', marginTop: 3 }}>{p.notes}</div>}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: '#047857', flexShrink: 0 }}>
                  {fmtMoney(p.amount)}
                </div>
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
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      await saveTechProfile({ phone, address, city, state, zip });
      onSaved({ ...profile, phone, address, city, state, zip });
      setMsg('Saved.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Couldn't save.");
    }
    setSaving(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="glass card" style={{ padding: 16 }}>
        <SectionHead noMargin>Your details</SectionHead>
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ReadOnly label="Name" value={profile.name} />
          <ReadOnly label="Email" value={profile.email ?? '—'} />
          {profile.business_name && <ReadOnly label="Business" value={profile.business_name} />}
          <div>
            <label style={LABEL}>Phone</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </div>
          <div>
            <label style={LABEL}>Address</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
            <div>
              <label style={LABEL}>City</label>
              <input className="input" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>State</label>
              <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
            </div>
            <div>
              <label style={LABEL}>ZIP</label>
              <input className="input" value={zip} onChange={(e) => setZip(e.target.value)} inputMode="numeric" />
            </div>
          </div>
          {msg && <div style={{ fontSize: 12, color: msg === 'Saved.' ? '#047857' : '#b91c1c' }}>{msg}</div>}
          <button className="btn btn-primary" onClick={save} disabled={saving} style={{ justifyContent: 'center', padding: '10px 0' }}>
            <Save size={14} /> {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="glass card" style={{ padding: 16 }}>
        <SectionHead noMargin>Paperwork</SectionHead>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <CheckRow ok={!!profile.w9_received} label="W-9 on file"
            detail={profile.w9_submitted_at ? `Submitted ${fmtDate(profile.w9_submitted_at)}` : 'Not received yet'} />
          <CheckRow ok={!!profile.contract_signed_at} label="Contractor agreement"
            detail={profile.contract_signed_at ? `Signed ${fmtDate(profile.contract_signed_at)}` : 'Not signed yet'} />
        </div>
        <div style={{ marginTop: 12, fontSize: 11, color: '#999', lineHeight: 1.5 }}>
          Banking and tax ID details are never shown here. To change them, use the
          secure W-9 link Fred sends you.
        </div>
      </div>
    </div>
  );
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <CheckCircle2 size={16} color={ok ? '#047857' : '#ccc'} style={{ flexShrink: 0 }} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#999' }}>{detail}</div>
      </div>
    </div>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label style={LABEL}>{label}</label>
      <div style={{ fontSize: 14, fontWeight: 600, padding: '2px 0' }}>{value}</div>
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────────────────────

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass card" style={{ padding: '12px 14px' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.8, color: '#999', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? 'var(--teal)' : '#333', marginTop: 3 }}>{value}</div>
    </div>
  );
}

function MenuItem({ icon, label, badge, danger, attention, onClick }: {
  icon: React.ReactNode; label: string; badge?: number;
  danger?: boolean; attention?: boolean; onClick: () => void;
}) {
  return (
    <button
      role="menuitem" onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 14px', background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 13.5, fontWeight: 600, textAlign: 'left',
        color: danger ? '#b91c1c' : '#333',
      }}
    >
      <span style={{ color: danger ? '#b91c1c' : attention ? '#b45309' : 'var(--teal)', display: 'flex' }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {badge != null && badge > 0 && (
        <span style={{
          borderRadius: 999, fontSize: 10, fontWeight: 800, padding: '2px 7px',
          background: attention ? 'rgba(245,158,11,0.18)' : 'rgba(13,115,119,0.10)',
          color: attention ? '#92400e' : 'var(--teal)',
        }}>
          {badge}
        </span>
      )}
    </button>
  );
}

/** "Jere Jones" becomes "JJ", for the menu button. */
function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '.';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
}

function SectionHead({ children, noMargin }: { children: React.ReactNode; noMargin?: boolean }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1.2, color: 'var(--teal)',
      textTransform: 'uppercase', marginBottom: noMargin ? 0 : 9,
    }}>{children}</div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass card" style={{ textAlign: 'center', padding: '30px 20px', color: '#aaa', fontSize: 13, marginBottom: 20 }}>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center' }}>{children}</div>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: '#555',
  textTransform: 'uppercase', display: 'block', marginBottom: 4,
};
