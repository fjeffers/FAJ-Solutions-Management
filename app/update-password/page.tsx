'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, Lock } from 'lucide-react';
import Link from 'next/link';

export default function UpdatePasswordPage() {
  const router = useRouter();
  // Same side the reset was asked for on (app/reset-password stores it): the
  // emailed link only signs in with the sign-in that asked for it.
  const supabase = createClient((() => {
    try { return typeof window !== 'undefined' && localStorage.getItem('pw-reset-next') === '/tech' ? 'field' : 'admin'; }
    catch { return 'admin'; }
  })());
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // The email link has to sign you in first. Supabase only manages that in the
  // same browser where the reset was asked for; anywhere else it fails quietly
  // and the new password could never save. Now the page checks and says so.
  const [linkOk, setLinkOk] = useState<boolean | null>(null);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { if (!off) setLinkOk(true); return; }
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error: ex } = await supabase.auth.exchangeCodeForSession(code);
        if (!off) setLinkOk(!ex);
        return;
      }
      if (!off) setLinkOk(false);
    })();
    return () => { off = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirm) { setError('Passwords do not match'); return; }
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
    let next = '/admin';
    try { next = localStorage.getItem('pw-reset-next') === '/tech' ? '/tech' : '/admin'; localStorage.removeItem('pw-reset-next'); } catch { /* private window */ }
    setTimeout(() => router.push(next), 2000);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass card" style={{ maxWidth: 420, width: '100%', padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Sparkles size={22} color="var(--gold)" style={{ marginBottom: 12 }} />
          <div className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>New Password</div>
          <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>Choose a strong new password</div>
        </div>

        {linkOk === false && !done ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: '#b91c1c', fontWeight: 700, marginBottom: 8 }}>This reset link didn&apos;t work here</div>
            <div style={{ fontSize: 13.5, color: '#555', marginBottom: 18 }}>
              The link has to be opened on the same phone or computer where you asked for it, and it only works once.
              Ask for a new link and open it on this device, or sign in and change your password in Settings / Profile.
            </div>
            <Link href="/reset-password" className="btn btn-primary" style={{ display: 'inline-flex', justifyContent: 'center', padding: '12px 20px', textDecoration: 'none' }}>
              Send a new link
            </Link>
          </div>
        ) : linkOk === null && !done ? (
          <div style={{ textAlign: 'center', color: '#666', fontSize: 13.5 }}>Checking your link…</div>
        ) : !done ? (
          <form onSubmit={handleUpdate}>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>NEW PASSWORD</label>
              <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus minLength={8} placeholder="Min 8 characters" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>CONFIRM PASSWORD</label>
              <input type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              <Lock size={14} /> {loading ? 'Updating...' : 'Update Password'}
            </button>
          </form>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ color: '#047857', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Password updated!</div>
            <div style={{ fontSize: 13, color: '#666' }}>Redirecting...</div>
          </div>
        )}
      </div>
    </div>
  );
}
