'use client';
// Check address, under the site address on the job form (lib/address-check.ts).
// Shows what the lookup found and how it compares with what was typed. Nothing
// changes until the office taps Use this, because a lookup can land on a
// different street (tested: "901 Canal Point Blvd" came back as "901 Canal Rd").
// Use this fills the fields and keeps that exact map position for the job.
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, MapPin, Search } from 'lucide-react';
import { matchKind, sameAddress, type CheckedAddress } from '@/lib/address-check';

type Form = { site_address?: string | null; site_city?: string | null; site_state?: string | null; site_zip?: string | null };

export default function AddressCheck({ form, onUse }: {
  form: Form;
  /** Fill the fields and the position with the checked address. */
  onUse: (a: CheckedAddress) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<CheckedAddress | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const line = [form.site_address, form.site_city, form.site_state, form.site_zip].map((v) => (v ?? '').trim()).filter(Boolean).join(', ');

  const check = async () => {
    setBusy(true); setMatch(null); setNote(null);
    try {
      const res = await fetch(`/api/address/check?q=${encodeURIComponent(line)}`);
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; match?: CheckedAddress | null; error?: string };
      if (!res.ok || !j.ok) setNote(j.error ?? "Couldn't check the address. Try again.");
      else if (!j.match) setNote('No match for this address. Check the street number, spelling and ZIP.');
      else setMatch(j.match);
    } catch {
      setNote("Couldn't check the address. Check your connection.");
    }
    setBusy(false);
  };

  const kind = match ? matchKind(match, form.site_address) : null;
  // OpenStreetMap gives the township ("West Windsor"), not the mailing town ("Princeton"): keep the typed town and ZIP.
  const use = (m: CheckedAddress): CheckedAddress => (m.source === 'osm'
    ? { ...m, city: (form.site_city ?? '').trim() || m.city, state: (form.site_state ?? '').trim() || m.state, zip: (form.site_zip ?? '').trim() || m.zip }
    : m);
  const already = match && sameAddress(use(match), form);
  const box = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const, padding: '10px 12px', borderRadius: 8, fontSize: 13 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button type="button" className="btn btn-ghost" disabled={busy || line.length < 5} onClick={() => void check()}
        style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <Search size={14} /> {busy ? 'Checking…' : 'Check address'}
      </button>
      {note && <div style={{ fontSize: 12.5, color: 'var(--danger, #C62828)' }}>{note}</div>}
      {match && kind === 'nobuilding' && (
        <div style={{ ...box, border: '1px solid #F2D49B', background: '#FFF8EA' }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, color: '#B45309' }} />
          <span style={{ flex: 1, minWidth: 180 }}>
            Found the street ({match.line}) but not that building number. The job keeps the address you typed.
          </span>
        </div>
      )}
      {match && kind !== 'nobuilding' && (
        <div style={{ ...box, border: `1px solid ${kind === 'street' ? '#F2D49B' : 'var(--border, #E5E7EB)'}`, background: kind === 'street' ? '#FFF8EA' : undefined }}>
          {kind === 'street' ? <AlertTriangle size={15} style={{ flexShrink: 0, color: '#B45309' }} /> : <MapPin size={15} style={{ flexShrink: 0 }} />}
          <span style={{ flex: 1, minWidth: 180 }}>
            <b>{use(match).line}</b>
            <span style={{ display: 'block', fontSize: 11.5, opacity: 0.75 }}>
              {kind === 'street' ? 'A different street than you typed. Check it is the right site before using it. '
                : already ? 'Matches what you typed. ' : 'Found: '}
              GPS {match.lat.toFixed(5)}, {match.lng.toFixed(5)} ·{' '}
              <a href={`https://www.google.com/maps/search/?api=1&query=${match.lat},${match.lng}`} target="_blank" rel="noopener noreferrer">see on map</a>
            </span>
          </span>
          <button type="button" className={kind === 'street' ? 'btn btn-ghost' : 'btn btn-gold'} onClick={() => { onUse(use(match)); setMatch(null); setNote(null); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <CheckCircle2 size={14} /> {already ? 'Use this position' : 'Use this address'}
          </button>
        </div>
      )}
    </div>
  );
}
