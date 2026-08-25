'use client';
import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import {
  fetchTechProfile, fetchTechJobs, fetchTechPayments, fetchTechSummary,
  saveTechProfile, splitJobs, paymentsByYear, jobLocation,
} from '@/lib/tech-portal';
import type { TechJob, TechPayment, TechProfile, TechSummary } from '@/lib/types';
import { fmtMoney, fmtDate } from '@/lib/utils';
import {
  HardHat, LogOut, Briefcase, Wallet, User, MapPin, Calendar, Clock,
  CheckCircle2, Save,
} from 'lucide-react';

type Tab = 'jobs' | 'pay' | 'profile';

export default function TechPortalPage() {
  const router = useRouter();
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [tab, setTab] = useState<Tab>('jobs');

  const [profile, setProfile] = useState<TechProfile | null>(null);
  const [jobs, setJobs] = useState<TechJob[]>([]);
  const [payments, setPayments] = useState<TechPayment[]>([]);
  const [summary, setSummary] = useState<TechSummary | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/tech/login'); return; }

      try {
        const me = await fetchTechProfile();
        // Signed in but not a linked tech — Fred's own account lands here too.
        if (!me) { setDenied(true); setLoading(false); return; }
        const [j, p, s] = await Promise.all([fetchTechJobs(), fetchTechPayments(), fetchTechSummary()]);
        setProfile(me); setJobs(j); setPayments(p); setSummary(s);
      } catch {
        setDenied(true);
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace('/tech/login');
  };

  const { active, past } = useMemo(() => splitJobs(jobs), [jobs]);

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
          <button onClick={signOut} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', cursor: 'pointer', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
            <LogOut size={14} /> Sign out
          </button>
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
          </div>
        )}

        {/* Tabs — big tap targets, scroll sideways rather than wrap on a phone */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <TabBtn active={tab === 'jobs'} onClick={() => setTab('jobs')} icon={<Briefcase size={14} />} label={`Jobs (${jobs.length})`} />
          <TabBtn active={tab === 'pay'} onClick={() => setTab('pay')} icon={<Wallet size={14} />} label={`Pay (${payments.length})`} />
          <TabBtn active={tab === 'profile'} onClick={() => setTab('profile')} icon={<User size={14} />} label="Profile" />
        </div>

        {tab === 'jobs' && <JobsTab active={active} past={past} />}
        {tab === 'pay' && <PayTab payments={payments} />}
        {tab === 'profile' && profile && <ProfileTab profile={profile} onSaved={(p) => setProfile(p)} />}
      </div>
    </div>
  );
}

// ── Jobs ────────────────────────────────────────────────────────────────────

function JobsTab({ active, past }: { active: TechJob[]; past: TechJob[] }) {
  return (
    <>
      <SectionHead>Active work{active.length > 0 && ` (${active.length})`}</SectionHead>
      {active.length === 0 ? (
        <Empty>Nothing assigned right now.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
          {active.map((j) => <JobCard key={j.id} job={j} />)}
        </div>
      )}

      <SectionHead>Past jobs{past.length > 0 && ` (${past.length})`}</SectionHead>
      {past.length === 0 ? (
        <Empty>Finished jobs will show up here.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {past.map((j) => <JobCard key={j.id} job={j} />)}
        </div>
      )}
    </>
  );
}

function JobCard({ job }: { job: TechJob }) {
  const where = jobLocation(job);
  const when = job.scheduled_date || job.start_date;
  return (
    <div className="glass card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--teal)' }}>WO {job.wo_number}</span>
            <StatusPill closed={job.is_closed} status={job.wo_status} />
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
    </div>
  );
}

function StatusPill({ closed, status }: { closed: boolean; status: string | null }) {
  const s = closed
    ? { label: status === 'Paid' ? 'Paid' : 'Closed', color: '#047857', bg: 'rgba(16,185,129,0.12)' }
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

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        padding: '9px 14px', borderRadius: 999, cursor: 'pointer', fontSize: 13, fontWeight: 700,
        border: active ? '1px solid var(--teal)' : '1px solid #e2e2e2',
        background: active ? 'var(--teal)' : 'transparent',
        color: active ? 'white' : '#666',
      }}
    >
      {icon} {label}
    </button>
  );
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
