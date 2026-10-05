'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Sparkles, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function ResetPasswordPage() {
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    // A tech comes here from the tech sign-in (?next=/tech) and goes back there after.
    try {
      const next = new URLSearchParams(window.location.search).get('next');
      localStorage.setItem('pw-reset-next', next === '/tech' ? '/tech' : '/');
    } catch { /* private window */ }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setSent(true);
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="glass card" style={{ maxWidth: 420, width: '100%', padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Sparkles size={22} color="var(--gold)" style={{ marginBottom: 12 }} />
          <div className="serif" style={{ fontSize: 28, fontWeight: 600, lineHeight: 1 }}>Reset Password</div>
          <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>
            Enter your email to receive a password reset link. Open the link on this same phone or computer.
          </div>
        </div>

        {!sent ? (
          <form onSubmit={handleReset}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 1, marginBottom: 6 }}>EMAIL</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
            </div>
            {error && <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', color: '#b91c1c', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>{error}</div>}
            <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '14px' }}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>&#9993;</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Check your email</div>
            <div style={{ fontSize: 13, color: '#666' }}>We sent a reset link to <strong>{email}</strong></div>
          </div>
        )}

        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Link href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--teal)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
            <ArrowLeft size={14} /> Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
