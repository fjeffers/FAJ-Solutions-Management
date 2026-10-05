'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { claimTechAccount } from '@/lib/tech-portal';
import { suggestUsername, usernameProblem, USERNAME_RULE } from '@/lib/usernames';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';

// The tech portal's sign-in (Fred, 2026-10-02: "change log in style so name
// and email address then user name and password").
//
//   Sign in:            username (or email) + password
//   Create your login:  name + email address, then username + password
//
// Both go through the server (app/api/tech/login, /signup), which turns a
// username into its login without ever telling the browser the email.

type Mode = 'signin' | 'signup';

export default function TechLoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('signin');
  const [login, setLogin] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchTo = (m: Mode) => { setMode(m); setError(null); setNotice(null); };

  const finishSignIn = async () => {
    // Bind this login to its contractor record. Safe on every sign-in — once
    // linked it short-circuits.
    const claim = await claimTechAccount();
    if (claim.ok) { router.push('/tech'); router.refresh(); return; }

    // Not a tech. The tech portal and the admin app stay separate (Fred,
    // 2026-10-02: "need to be separate from admin"): an owner or staff login is
    // told so and signed out here, never carried into admin from this page.
    const { data: who } = await supabase.rpc('wf_role');
    const role = (who as { role?: string } | null)?.role;

    if (role === 'owner') {
      setError("That's the management (owner) login. The tech portal only opens with a tech login — sign in here with a tech username.");
    } else if (role === 'staff') {
      setError("That login is for the office (assistant or accountant), not the tech portal.");
    } else if (claim.reason === 'no_matching_contractor') {
      setError("Signed in, but this login's email isn't on any tech record. Ask Fred to put this email on your tech record, then sign in again.");
    } else if (claim.reason === 'email_not_confirmed') {
      setError('Check your inbox and confirm your email address, then sign in again.');
    } else {
      setError('Signed in, but we could not open your tech account. Contact Fred.');
    }
    await supabase.auth.signOut();
    setLoading(false);
  };

  const post = async (path: string, body: Record<string, string>) => {
    try {
      const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return (await res.json()) as { ok: boolean; error?: string; reason?: string; confirmEmail?: boolean; usernameSaved?: boolean };
    } catch {
      return { ok: false, error: 'Connection problem — check your internet and try again.' };
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null); setNotice(null);
    const r = await post('/api/tech/login', { login, password });
    if (!r.ok) { setError(r.error ?? "That didn't work. Try again."); setLoading(false); return; }
    await finishSignIn();
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = usernameProblem(username);
    if (problem) { setError(problem); return; }
    setLoading(true); setError(null); setNotice(null);
    const r = await post('/api/tech/signup', { name, email, username, password });
    if (!r.ok) {
      setError(r.error ?? "Couldn't make your login. Try again.");
      if (r.reason === 'email_taken') { setMode('signin'); setLogin(email); }
      setLoading(false);
      return;
    }
    setMode('signin');
    setLogin(r.usernameSaved ? username.trim().toLowerCase() : email);
    setPassword('');
    setNotice(r.confirmEmail
      ? `Almost done. We emailed a confirmation link to ${email} — open it (check spam too), then sign in here with your ${r.usernameSaved ? 'username' : 'email'} and password.`
      : `Your login is ready. Sign in with your ${r.usernameSaved ? 'username' : 'email'} and password.`);
    setLoading(false);
  };

  const passwordField = (
    <div>
      <label style={LABEL} htmlFor="tl-password">Password</label>
      <div style={{ position: 'relative' }}>
        <input
          id="tl-password" className="wf-input" type={showPassword ? 'text' : 'password'} required
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
          style={{ paddingRight: 44 }}
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
  );

  return (
    // WorkFlow's look (Fred, 2026-10-02): the night-photo header over a white card.
    <div className="wf wf-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="wf-card" style={{ maxWidth: 440, width: '100%', overflow: 'hidden' }}>
        <div className="wf-hero" style={{ borderRadius: 0, textAlign: 'center', padding: '26px 24px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wf/logo-wide.png" alt="FAJ Solutions — Technology. Delivered." style={{ width: 220, maxWidth: '80%', height: 'auto', marginBottom: 6 }} />
          <div className="wf-hero-greet" style={{ fontSize: 30 }}>Tech Portal</div>
          <div style={{ color: 'rgba(255,255,255,0.82)', marginTop: 6, fontSize: 13 }}>
            {mode === 'signin' ? 'Your jobs, your hours, your pay.' : 'Make your login. Use the email Fred has on file for you.'}
          </div>
        </div>
        <div style={{ padding: 24 }}>

          {mode === 'signin' ? (
            <form onSubmit={handleSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={LABEL} htmlFor="tl-login">Username</label>
                <input
                  id="tl-login" className="wf-input" required autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={login} onChange={(e) => setLogin(e.target.value)}
                  placeholder="Your username (or email)"
                />
              </div>
              {passwordField}
              <Messages error={error} notice={notice} />
              <button className="wf-btn wf-btn-navy" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="wf-display" style={SECTION}>About you</div>
              <div>
                <label style={LABEL} htmlFor="tl-name">Name</label>
                <input
                  id="tl-name" className="wf-input" required autoComplete="name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!usernameTouched) setUsername(suggestUsername(e.target.value));
                  }}
                  placeholder="First and last name"
                />
              </div>
              <div>
                <label style={LABEL} htmlFor="tl-email">Email address</label>
                <input
                  id="tl-email" className="wf-input" type="email" required autoComplete="email" autoCapitalize="none"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="The email Fred has on file for you"
                />
              </div>

              <div className="wf-display" style={{ ...SECTION, marginTop: 6 }}>Your login</div>
              <div>
                <label style={LABEL} htmlFor="tl-username">Username</label>
                <input
                  id="tl-username" className="wf-input" required autoComplete="username" autoCapitalize="none" spellCheck={false}
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); setUsernameTouched(true); }}
                  placeholder="e.g. jere.jones"
                />
                <div style={{ fontSize: 11.5, color: 'var(--wf-subtle)', marginTop: 4 }}>{USERNAME_RULE}.</div>
              </div>
              {passwordField}
              <Messages error={error} notice={notice} />
              <button className="wf-btn wf-btn-navy" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Making your login…' : 'Create login'}
              </button>
            </form>
          )}

          <div style={{ marginTop: 18, textAlign: 'center', fontSize: 13, color: '#666' }}>
            {mode === 'signin' ? (
              <>
                <button onClick={() => switchTo('signup')} style={LINK_BTN}>
                  First time? Create your login
                </button>
                <div style={{ marginTop: 8 }}>
                  <Link href="/reset-password?next=/tech" style={{ color: 'var(--wf-navy)', fontSize: 12 }}>Forgot password?</Link>
                </div>
              </>
            ) : (
              <button onClick={() => switchTo('signin')} style={LINK_BTN}>
                Already have a login? Sign in
              </button>
            )}
          </div>

          <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid #eee', fontSize: 11, color: '#999', textAlign: 'center', lineHeight: 1.5 }}>
            Your login only ever shows your own jobs and your own pay.
          </div>
        </div>
      </div>
    </div>
  );
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && (
        <div role="alert" style={{ background: 'rgba(239,68,68,0.1)', color: '#b91c1c', padding: '10px 12px', borderRadius: 10, fontSize: 13 }}>
          {error}
        </div>
      )}
      {notice && (
        <div role="status" style={{ background: 'rgba(16,185,129,0.1)', color: '#047857', padding: '10px 12px', borderRadius: 10, fontSize: 13 }}>
          {notice}
        </div>
      )}
    </>
  );
}

const LABEL: React.CSSProperties = {
  fontSize: 12.5, fontWeight: 600, color: 'var(--wf-text)', display: 'block', marginBottom: 5,
};

const SECTION: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: 'var(--wf-gold-dark)',
  borderBottom: '1px solid var(--wf-line)', paddingBottom: 6,
};

const LINK_BTN: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--wf-navy)', fontSize: 13, fontWeight: 600, padding: 0, fontFamily: 'inherit',
};
