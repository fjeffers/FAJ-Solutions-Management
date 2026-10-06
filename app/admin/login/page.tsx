'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { claimTechAccount } from '@/lib/tech-portal';
import { claimAssistantAccount, sectionForRole } from '@/lib/assistant';
import { Mail, Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

type Mode = 'password' | 'magic';

// Translate Supabase's technical errors into plain English
function friendlyError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return "That email and password don't match. Try again, or use \"Forgot password?\" below.";
  if (m.includes('rate limit')) return 'Too many attempts — wait a minute and try again.';
  if (m.includes('email not confirmed')) return "This email hasn't been confirmed yet — check your inbox for the confirmation link.";
  if (m.includes('failed to fetch') || m.includes('network')) return 'Connection problem — check your internet and try again.';
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Already signed in on this device with a login that isn't the
  // administrator (e.g. Fred's tech login): say so, and offer to switch.
  const [signedInAs, setSignedInAs] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: who } = await supabase.rpc('wf_role');
      if ((who as { role?: string } | null)?.role === 'owner') { router.replace('/admin'); return; }
      setSignedInAs(user.email ?? 'another login');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const switchLogin = async () => {
    await supabase.auth.signOut();
    setSignedInAs(null);
    setError(null);
  };
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(friendlyError(error.message)); setLoading(false); return; }

    // Assistants and techs land in their own sections. The owner app would
    // show them an empty shell — RLS is keyed to Fred's user id, so they'd get
    // zero rows. Both claims refuse a business owner, so Fred always lands here.
    const staff = await claimAssistantAccount();
    const section = staff.ok ? sectionForRole(staff.role) : null;
    if (section) { router.push(section); router.refresh(); return; }
    // This page is the administrator sign-in (Fred, 2026-10-06: "/admin for
    // the administrator login, /tech for the tech portal"). A tech login is
    // told where it belongs and signed out — never carried across.
    const { data: who } = await supabase.rpc('wf_role');
    if ((who as { role?: string } | null)?.role === 'owner') { router.push('/admin'); router.refresh(); return; }
    const claim = await claimTechAccount();
    await supabase.auth.signOut();
    setError(claim.ok
      ? "That's a tech login. Techs sign in at app.fajsolutions.com/tech — this page is for the administrator."
      : "That login isn't set up for the office. The administrator signs in here; techs sign in at app.fajsolutions.com/tech.");
    setLoading(false);
  };

  const sendMagicLink = async (): Promise<boolean> => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });
    setLoading(false);
    if (error) { setError(friendlyError(error.message)); return false; }
    return true;
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await sendMagicLink()) setSent(true);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass card" style={{ maxWidth: 420, width: '100%', padding: 40, overflow: 'hidden' }}>
        {/* Fred's logo (2026-10-02). The logo is light-on-dark, so it sits on a navy band. */}
        <div style={{ margin: '-40px -40px 26px', padding: '24px 20px', textAlign: 'center', background: 'linear-gradient(180deg, #13284A 0%, #0E1B2E 100%)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ width: 240, maxWidth: '85%', height: 'auto' }} />
        </div>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div className="serif" style={{ fontSize: 34, fontWeight: 600, lineHeight: 1 }}>Business Manager</div>
          <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Administrator sign-in</div>
        </div>

        {signedInAs && (
          <div role="status" style={{ marginBottom: 20, padding: '12px 14px', borderRadius: 10, background: '#fff8eb', border: '1px solid #f3dfb8', fontSize: 13, color: '#7c4a03', lineHeight: 1.5 }}>
            This phone or browser is signed in as <strong>{signedInAs}</strong>, which is not the administrator login.
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={switchLogin} style={{ fontSize: 13 }}>Sign out and sign in as administrator</button>
              <Link href="/tech" className="btn btn-ghost" style={{ fontSize: 13 }}>Go to the tech portal</Link>
            </div>
          </div>
        )}

        {/* Mode tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, borderRadius: 10, overflow: 'hidden', border: '1px solid #e5e7eb' }}>
          <button
            onClick={() => { setMode('password'); setError(null); setSent(false); }}
            style={{ flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, border: 'none', cursor: 'pointer', transition: 'all 0.15s', background: mode === 'password' ? 'var(--teal)' : 'white', color: mode === 'password' ? 'white' : '#555' }}
          >
            PASSWORD
          </button>
          <button
            onClick={() => { setMode('magic'); setError(null); setSent(false); }}
            style={{ flex: 1, padding: '10px 0', fontSize: 12, fontWeight: 700, letterSpacing: 0.5, border: 'none', cursor: 'pointer', transition: 'all 0.15s', background: mode === 'magic' ? 'var(--teal)' : 'white', color: mode === 'magic' ? 'white' : '#555' }}
          >
            EMAIL LINK
          </button>
        </div>

        {mode === 'password' && (
          <form onSubmit={handlePasswordLogin}>
            <div style={{ marginBottom: 14 }}>
              <label htmlFor="login-email" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>EMAIL</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="login-password" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>PASSWORD</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  style={{ paddingRight: 42 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#999',
                    display: 'flex', alignItems: 'center', padding: 4,
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <Link href="/reset-password" style={{ fontSize: 12, color: 'var(--teal)', fontWeight: 600, textDecoration: 'none' }}>
                Forgot password?
              </Link>
            </div>
          </form>
        )}

        {mode === 'magic' && !sent && (
          <form onSubmit={handleMagicLink}>
            <div style={{ marginBottom: 20 }}>
              <label htmlFor="magic-email" style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>YOUR EMAIL</label>
              <input
                id="magic-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                placeholder="you@example.com"
              />
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              {loading ? 'Sending link...' : 'Send Magic Link'}
            </button>
          </form>
        )}

        {mode === 'magic' && sent && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Mail size={32} color="var(--teal)" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Check your email</div>
            <div style={{ fontSize: 13, color: '#666' }}>We sent a magic link to <strong>{email}</strong></div>
            {error && (
              <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginTop: 14, textAlign: 'left' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={loading}
                onClick={async () => {
                  setResent(false);
                  if (await sendMagicLink()) setResent(true);
                }}
                style={{ fontSize: 12 }}
              >
                {loading ? 'Sending…' : resent ? 'Sent again ✓' : "Didn't get it? Resend"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { setSent(false); setResent(false); setError(null); }}
                style={{ fontSize: 12 }}
              >
                Use a different email
              </button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #eee', textAlign: 'center', fontSize: 12.5, color: '#777' }}>
          Are you a tech? <Link href="/tech/login" style={{ color: 'var(--teal)', fontWeight: 700 }}>Sign in at app.fajsolutions.com/tech</Link>
        </div>
      </div>
    </div>
  );
}
