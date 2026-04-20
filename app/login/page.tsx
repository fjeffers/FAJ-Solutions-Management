'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Mail } from 'lucide-react';

type Mode = 'password' | 'magic';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError(error.message); setLoading(false); return; }

    // Detect if this user is a contractor → send to contractor portal
    const { data: contractor } = await supabase
      .from('contractors')
      .select('name')
      .eq('email', email)
      .maybeSingle();

    router.push(contractor ? '/contractor' : '/');
    router.refresh();
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const origin = window.location.origin;
    // Detect role first (best-effort — may not exist yet if first invite)
    const { data: contractor } = await supabase
      .from('contractors')
      .select('name')
      .eq('email', email)
      .maybeSingle();

    const redirectTo = contractor
      ? `${origin}/contractor`
      : `${origin}/`;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setSent(true);
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass card" style={{ maxWidth: 420, width: '100%', padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Sparkles size={22} color="var(--gold)" />
            <span className="display" style={{ fontSize: 14, color: 'var(--gold)', fontWeight: 700 }}>FAJ</span>
          </div>
          <div className="serif" style={{ fontSize: 38, fontWeight: 600, lineHeight: 1 }}>Business Manager</div>
          <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Sign in to continue</div>
        </div>

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
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>EMAIL</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>PASSWORD</label>
              <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {mode === 'magic' && !sent && (
          <form onSubmit={handleMagicLink}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>YOUR EMAIL</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="Enter your email address" />
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              <Mail size={14} />
              {loading ? 'Sending...' : 'Send Login Link'}
            </button>
            <div style={{ fontSize: 12, color: '#999', textAlign: 'center', marginTop: 12 }}>
              {"We'll email you a one-click sign-in link. No password needed."}
            </div>
          </form>
        )}

        {mode === 'magic' && sent && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(13,115,119,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <Mail size={24} color="var(--teal)" />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Check your email</div>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
              We sent a login link to <strong>{email}</strong>.<br />Click it to sign in instantly.
            </div>
            <button onClick={() => setSent(false)} style={{ marginTop: 20, fontSize: 12, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
              Send again
            </button>
          </div>
        )}

        <div style={{ marginTop: 20, fontSize: 11, color: '#999', textAlign: 'center' }}>FAJ Solutions</div>
      </div>
    </div>
  );
}
