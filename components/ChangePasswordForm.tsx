'use client';
// Change your own password while signed in: current password, new password
// twice. The server checks the current one and saves the new one
// (app/api/account/password). Used in the owner's Settings and the tech
// portal's Profile (Fred, 2026-10-05: "it doesn't take, both for myself and tech").
import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { passwordProblem, PASSWORD_MIN } from '@/lib/password-rules';

export default function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(false);
    const problem = passwordProblem(next, confirm, current);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current, next, confirm }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) { setError(json.error ?? "The password wasn't changed. Try again."); return; }
      setDone(true);
      setCurrent(''); setNext(''); setConfirm('');
    } catch {
      setError("No connection — the password wasn't changed. Try again when you have signal.");
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, auto: string) => (
    <div>
      <label htmlFor={id} className="wf-label" style={{ display: 'block', marginBottom: 4 }}>{label}</label>
      <input id={id} className="wf-input" type={show ? 'text' : 'password'} value={value} autoComplete={auto}
        onChange={(e) => { set(e.target.value); setError(null); setDone(false); }} />
    </div>
  );

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 420 }}>
      {field('pw-current', 'Current password', current, setCurrent, 'current-password')}
      {field('pw-new', `New password (at least ${PASSWORD_MIN} characters)`, next, setNext, 'new-password')}
      {field('pw-confirm', 'New password again', confirm, setConfirm, 'new-password')}
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', alignSelf: 'flex-start' }}>
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
        {show ? <EyeOff size={14} /> : <Eye size={14} />} Show passwords
      </label>
      {error && <div role="alert" style={{ padding: 10, background: 'rgba(198,40,40,0.08)', color: 'var(--wf-danger)', borderRadius: 8, fontSize: 13.5 }}>{error}</div>}
      {done && (
        <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, background: 'rgba(4,120,87,0.08)', color: 'var(--wf-success)', borderRadius: 8, fontSize: 13.5, fontWeight: 600 }}>
          <CheckCircle2 size={16} /> Password changed. Use the new one next time you sign in.
        </div>
      )}
      <button type="submit" className="wf-btn wf-btn-navy" disabled={busy} style={{ alignSelf: 'flex-start' }}>
        <Lock size={15} /> {busy ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}
