'use client';
// Onboarding paperwork, filed by the tech from their own portal (migration 049).
//
// Only shown for kind='contractor'. A helper link never sees this section, and
// portal_submit_document refuses it server-side too — a helper must not be able
// to file someone's tax form or sign their agreement.
import { useState } from 'react';

type Props = {
  token: string;
  w9Received: boolean;
  w9SubmittedAt: string | null;
  contractUrl: string | null;
  contractSignedAt: string | null;
  contractSignedName: string | null;
  contractorName: string;
};

const card: React.CSSProperties = {
  background: '#fff', border: '1px solid #eee', borderRadius: 12,
  padding: '15px 17px', marginBottom: 12,
};
const label: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1,
  textTransform: 'uppercase', color: '#999',
};
const btn: React.CSSProperties = {
  background: '#0D7377', color: '#fff', border: 'none', borderRadius: 8,
  padding: '10px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
};
const done: React.CSSProperties = {
  fontSize: 12, fontWeight: 700, color: '#047857',
};

function fmt(d: string | null) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function PortalDocuments({
  token, w9Received, w9SubmittedAt, contractUrl, contractSignedAt, contractSignedName, contractorName,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [w9Done, setW9Done] = useState(w9Received);
  const [signedAt, setSignedAt] = useState(contractSignedAt);
  const [typedName, setTypedName] = useState('');

  const uploadW9 = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const fd = new FormData();
      fd.append('token', token);
      fd.append('kind', 'w9');
      fd.append('file', file);
      const res = await fetch('/api/portal/documents', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Upload failed');
      setW9Done(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    if (!typedName.trim()) return setErr('Type your full name to sign');
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/portal/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind: 'contract', signed_name: typedName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not record signature');
      setSignedAt(new Date().toISOString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not record signature');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ ...label, marginBottom: 8 }}>Your paperwork</div>

      {err && (
        <div style={{ background: 'rgba(185,28,28,0.08)', color: '#b91c1c', borderRadius: 8, padding: '9px 12px', fontSize: 12, marginBottom: 10 }}>
          {err}
        </div>
      )}

      {/* ── W-9 ── */}
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>W-9 tax form</div>
          {w9Done && <span style={done}>✓ Received{w9SubmittedAt ? ` ${fmt(w9SubmittedAt)}` : ''}</span>}
        </div>
        <div style={{ fontSize: 12, color: '#666', margin: '5px 0 10px' }}>
          {w9Done
            ? 'On file. Upload again only if your details have changed.'
            : 'Needed before you can be paid. A photo of the signed form is fine.'}
        </div>
        <label style={{ ...btn, display: 'inline-block', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Uploading…' : w9Done ? 'Replace W-9' : 'Upload W-9'}
          <input
            type="file"
            accept="image/*,application/pdf"
            disabled={busy}
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadW9(f);
              e.target.value = '';
            }}
          />
        </label>
        <div style={{ fontSize: 11, color: '#999', marginTop: 7 }}>
          Stored privately. Only FAJ Solutions can open it.
        </div>
      </div>

      {/* ── Contractor agreement ── */}
      <div style={card}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>Contractor agreement</div>
          {signedAt && (
            <span style={done}>
              ✓ Signed {fmt(signedAt)}{contractSignedName ? ` by ${contractSignedName}` : ''}
            </span>
          )}
        </div>

        {contractUrl && (
          <div style={{ margin: '7px 0' }}>
            <a href={contractUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12.5, color: '#0D7377', fontWeight: 700 }}>
              Read the agreement →
            </a>
          </div>
        )}

        {signedAt ? (
          <div style={{ fontSize: 12, color: '#666', marginTop: 5 }}>
            Your signature is on file. Contact FAJ Solutions if anything needs to change.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: '#666', margin: '5px 0 9px' }}>
              Type your full legal name to sign. This records the date and time as your signature.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder={contractorName}
                style={{
                  flex: '1 1 180px', minWidth: 0, padding: '10px 12px', fontSize: 14,
                  border: '1px solid #ddd', borderRadius: 8, fontFamily: 'Georgia, serif',
                }}
              />
              <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void sign()}>
                {busy ? 'Signing…' : 'Sign'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
