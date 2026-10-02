'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { claimTechAccount } from '@/lib/tech-portal';
import { HardHat, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

// Same plain-English translation the owner login uses. A tech seeing
// "invalid login credentials" calls Fred; a tech seeing "that email and
// password don't match" tries again.
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return "That email and password don't match. Try again, or use \"Forgot password?\" below.";
  if (m.includes('rate limit')) return 'Too many attempts — wait a minute and try again.';
  if (m.includes('email not confirmed')) return "Your email hasn't been confirmed yet — check your inbox for the confirmation link.";
  if (m.includes('failed to fetch') || m.includes('network')) return 'Connection problem — check your internet and try again.';
  if (m.includes('already registered')) return 'There is already an account for this email — sign in instead.';
  return message;
}

type Mode = 'signin' | 'signup';

export default function TechLoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const finishSignIn = async () => {
    // Bind this login to its contractor record. Safe on every sign-in — once
    // linked it short-circuits.
    const claim = await claimTechAccount();
    if (claim.ok) { router.push('/tech'); router.refresh(); return; }

    // Signed in, but this account is not a tech. Rather than dropping them on
    // an empty screen, say which case it is.
    if (claim.reason === 'no_matching_contractor') {
      setError('Signed in, but this email is not set up as a tech yet. Ask Fred to add it to your contractor record.');
    } else if (claim.reason === 'email_not_confirmed') {
      setError('Check your inbox and confirm your email address, then sign in again.');
    } else {
      setError('Signed in, but we could not open your tech account. Contact Fred.');
    }
    await supabase.auth.signOut();
    setLoading(false);
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null); setNotice(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(friendlyError(error.message)); setLoading(false); return; }
    await finishSignIn();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null); setNotice(null);
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: `${window.location.origin}/tech` },
    });
    if (error) { setError(friendlyError(error.message)); setLoading(false); return; }

    // With email confirmation on, there is no session yet — the tech has to
    // click the link first. With it off, Supabase returns a session and we can
    // go straight in.
    if (data.session) { await finishSignIn(); return; }
    setNotice('Check your email for a confirmation link, then come back and sign in.');
    setLoading(false);
  };

  return (
    // WorkFlow's look (Fred, 2026-10-02): the night-photo header over a white card.
    <div className="wf wf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="wf-card" style={{ maxWidth: 420, width: '100%', overflow: 'hidden' }}>
        <div className="wf-hero" style={{ borderRadius: 0, textAlign: 'center', padding: '28px 24px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <HardHat size={18} color="var(--wf-gold)" />
            <span className="wf-display" style={{ fontSize: 12, letterSpacing: 1.6, color: 'var(--wf-gold)', fontWeight: 700 }}>FAJ SOLUTIONS</span>
          </div>
          <div className="wf-hero-greet" style={{ fontSize: 30 }}>Tech Portal</div>
          <div style={{ color: 'rgba(255,255,255,0.82)', marginTop: 6, fontSize: 13 }}>
            {mode === 'signin' ? 'Your jobs, your hours, your pay.' : 'Set up your login with the email Fred has on file.'}
          </div>
        </div>
        <div style={{ padding: 24 }}>

        <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={LABEL}>Email</label>
            <input
              className="wf-input" type="email" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label style={LABEL}>Password</label>
            <div style={{ position: 'relative' }}>
              <input
                className="wf-input" type={showPassword ? 'text' : 'password'} required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
                style={{ paddingRight: 40 }}
              />
              <button
                type="button" onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#999', padding: 12, display: 'flex', alignItems: 'center' }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ background: 'rgba(239,68,68,0.1)', color: '#b91c1c', padding: '10px 12px', borderRadius: 8, fontSize: 13 }}>
              {error}
            </div>
          )}
          {notice && (
            <div style={{ background: 'rgba(16,185,129,0.1)', color: '#047857', padding: '10px 12px', borderRadius: 8, fontSize: 13 }}>
              {notice}
            </div>
          )}

          <button className="wf-btn wf-btn-navy" type="submit" disabled={loading} style={{ width: '100%' }}>
            {loading ? 'Working…' : mode === 'signin' ? 'Sign In' : 'Create Login'}
          </button>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: '#666' }}>
          {mode === 'signin' ? (
            <>
              <button onClick={() => { setMode('signup'); setError(null); setNotice(null); }} style={LINK_BTN}>
                First time? Create your login
              </button>
              <div style={{ marginTop: 8 }}>
                <Link href="/reset-password" style={{ color: 'var(--wf-navy)', fontSize: 12 }}>Forgot password?</Link>
              </div>
            </>
          ) : (
            <button onClick={() => { setMode('signin'); setError(null); setNotice(null); }} style={LINK_BTN}>
              Already have a login? Sign in
            </button>
          )}
        </div>

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 1.5 }}>
          Use the email address Fred has on file for you. Your login only ever
          shows your own jobs and your own pay.
        </div>
        </div>
      </div>
    </div>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--wf-subtle)', display: 'block', marginBottom: 5,
};

const LINK_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--wf-navy)', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: 'inherit',
};
