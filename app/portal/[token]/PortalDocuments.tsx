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

const input: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', border: '1px solid #ddd',
  borderRadius: 8, padding: '9px 11px', fontSize: 14, fontFamily: 'inherit',
};
const row: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };

const ENTITY_OPTIONS = [
  'Individual/Sole Proprietor', 'C Corporation', 'S Corporation',
  'Partnership', 'Trust/Estate', 'LLC', 'Other',
];

function W9Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ flex: 1, minWidth: 110, display: 'block' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#666', display: 'block', marginBottom: 4 }}>
        {label}{required && <span style={{ color: '#b91c1c' }}> *</span>}
      </span>
      {children}
    </label>
  );
}

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
  // Open on arrival when nothing is filed yet — a tech sent here to do their
  // W-9 should see the fields, not a button that hides them.
  const [formOpen, setFormOpen] = useState(!w9Received);
  const [w9, setW9] = useState({
    legal_name: contractorName ?? '', business_name: '',
    entity_type: 'Individual/Sole Proprietor', tax_id_type: 'SSN', tax_id: '',
    address: '', city: '', state: '', zip: '', phone: '', email: '', signed_name: '',
  });
  const setW9v = (k: keyof typeof w9, v: string) => setW9((f) => ({ ...f, [k]: v }));

  const submitW9Details = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/portal/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind: 'w9_details', ...w9 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not submit your details');
      setW9Done(true);
      setFormOpen(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not submit your details');
    } finally {
      setBusy(false);
    }
  };

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
            ? 'On file. Fill this in again only if your details have changed.'
            : 'Needed before you can be paid. Fill in the form below — it takes a minute.'}
        </div>

        {/* Filling the form in is the main path: it is the only version the
            office can actually act on, and a new contractor's details exist
            nowhere else. Uploading a photo is offered underneath. */}
        <div>
          {!formOpen && (
            <button type="button" style={{ ...btn }} onClick={() => setFormOpen(true)}>
              {w9Done ? 'Update my W-9 details' : 'Fill in my W-9'}
            </button>
          )}

          {formOpen && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <W9Field label="Legal name (as shown on your tax return)" required>
                <input style={input} value={w9.legal_name} onChange={(e) => setW9v('legal_name', e.target.value)} />
              </W9Field>
              <W9Field label="Business name (only if different)">
                <input style={input} value={w9.business_name} onChange={(e) => setW9v('business_name', e.target.value)} />
              </W9Field>

              <div style={row}>
                <W9Field label="Federal tax classification">
                  <select style={input} value={w9.entity_type} onChange={(e) => setW9v('entity_type', e.target.value)}>
                    {ENTITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </W9Field>
                <W9Field label="TIN type" required>
                  <select style={input} value={w9.tax_id_type} onChange={(e) => setW9v('tax_id_type', e.target.value)}>
                    <option value="SSN">SSN</option>
                    <option value="EIN">EIN</option>
                  </select>
                </W9Field>
              </div>

              <W9Field label={w9.tax_id_type === 'EIN' ? 'Employer ID number' : 'Social Security number'} required>
                <input
                  style={input}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={w9.tax_id_type === 'EIN' ? '12-3456789' : '123-45-6789'}
                  value={w9.tax_id}
                  onChange={(e) => setW9v('tax_id', e.target.value)}
                />
              </W9Field>

              <W9Field label="Street address" required>
                <input style={input} value={w9.address} onChange={(e) => setW9v('address', e.target.value)} />
              </W9Field>
              <div style={row}>
                <W9Field label="City" required><input style={input} value={w9.city} onChange={(e) => setW9v('city', e.target.value)} /></W9Field>
                <W9Field label="State" required><input style={input} maxLength={2} value={w9.state} onChange={(e) => setW9v('state', e.target.value.toUpperCase())} /></W9Field>
                <W9Field label="ZIP" required><input style={input} inputMode="numeric" value={w9.zip} onChange={(e) => setW9v('zip', e.target.value)} /></W9Field>
              </div>
              <div style={row}>
                <W9Field label="Phone"><input style={input} value={w9.phone} onChange={(e) => setW9v('phone', e.target.value)} /></W9Field>
                <W9Field label="Email"><input style={input} type="email" value={w9.email} onChange={(e) => setW9v('email', e.target.value)} /></W9Field>
              </div>

              <div style={{ background: '#f7f7f7', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#555', lineHeight: 1.5 }}>
                By typing your name below you certify that the TIN shown is correct and
                that you are not subject to backup withholding.
              </div>
              <W9Field label="Type your full name to certify" required>
                <input style={input} value={w9.signed_name} onChange={(e) => setW9v('signed_name', e.target.value)} />
              </W9Field>

              <button style={{ ...btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => void submitW9Details()}>
                {busy ? 'Submitting…' : 'Submit my W-9 details'}
              </button>
              <div style={{ fontSize: 11, color: '#999' }}>
                Your tax ID is stored privately and is never shown to other contractors.
              </div>
            </div>
          )}
        </div>

        {/* Secondary: a photo of a signed form. Kept because it is the legal
            record, but it is not what the office can act on by itself. */}
        <div style={{ borderTop: '1px solid #eee', marginTop: 14, paddingTop: 12 }}>
          <div style={{ fontSize: 11.5, color: '#777', marginBottom: 8 }}>
            Already have a signed W-9? You can send a photo or PDF of it as well.
          </div>
          <label style={{
            display: 'inline-block', cursor: busy ? 'default' : 'pointer',
            border: '1px solid #ddd', borderRadius: 8, padding: '8px 14px',
            fontSize: 12.5, fontWeight: 700, color: '#555', opacity: busy ? 0.6 : 1,
          }}>
            {busy ? 'Uploading…' : 'Attach signed W-9'}
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
