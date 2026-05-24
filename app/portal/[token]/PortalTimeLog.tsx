'use client';
import { useState } from 'react';

interface TimeEntry {
  timestamp: string | null;
  lat?: number | null;
  lng?: number | null;
}

interface Props {
  woId:             string;
  token:            string;
  travelStartAt?:   string | null;
  travelStartLat?:  number | null;
  travelStartLng?:  number | null;
  arrivedAt?:       string | null;
  arrivedLat?:      number | null;
  arrivedLng?:      number | null;
  checkedInAt?:     string | null;
  checkedOutAt?:    string | null;
}

type Phase = 'idle' | 'traveling' | 'arrived' | 'working' | 'done';

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDuration(fromIso: string, toIso: string): string {
  const mins = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function coordLabel(lat?: number | null, lng?: number | null): string {
  if (lat == null || lng == null) return '';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

export default function PortalTimeLog({
  woId,
  token,
  travelStartAt,
  travelStartLat,
  travelStartLng,
  arrivedAt,
  arrivedLat,
  arrivedLng,
  checkedInAt,
  checkedOutAt,
}: Props) {
  // Derive initial phase from existing data
  function derivePhase(): Phase {
    if (checkedOutAt) return 'done';
    if (checkedInAt)  return 'working';
    if (arrivedAt)    return 'arrived';
    if (travelStartAt) return 'traveling';
    return 'idle';
  }

  const [phase, setPhase]     = useState<Phase>(derivePhase);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Local copies so UI stays fresh without a page reload
  const [travel, setTravel]   = useState<TimeEntry>({ timestamp: travelStartAt ?? null, lat: travelStartLat, lng: travelStartLng });
  const [arrived, setArrived] = useState<TimeEntry>({ timestamp: arrivedAt ?? null, lat: arrivedLat, lng: arrivedLng });
  const [inAt, setInAt]       = useState<string | null>(checkedInAt ?? null);
  const [outAt, setOutAt]     = useState<string | null>(checkedOutAt ?? null);

  async function save(field: string, value: Record<string, unknown>) {
    const res = await fetch('/api/portal/update', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, wo_id: woId, field, value }),
    });
    if (!res.ok) throw new Error('Failed to save');
  }

  async function getGPS(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        ()    => resolve(null),
        { timeout: 8000, maximumAge: 30000 },
      );
    });
  }

  async function handleOnMyWay() {
    setBusy(true);
    setError(null);
    try {
      const gps = await getGPS();
      const now = new Date().toISOString();
      await save('travel_start', { timestamp: now, lat: gps?.lat ?? null, lng: gps?.lng ?? null });
      setTravel({ timestamp: now, lat: gps?.lat, lng: gps?.lng });
      setPhase('traveling');
    } catch {
      setError('Could not record travel start. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleArrived() {
    setBusy(true);
    setError(null);
    try {
      const gps = await getGPS();
      const now = new Date().toISOString();
      await save('arrived', { timestamp: now, lat: gps?.lat ?? null, lng: gps?.lng ?? null });
      setArrived({ timestamp: now, lat: gps?.lat, lng: gps?.lng });
      setPhase('arrived');
    } catch {
      setError('Could not record arrival. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckIn() {
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await save('check_in', { timestamp: now });
      setInAt(now);
      setPhase('working');
    } catch {
      setError('Could not record check-in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckOut() {
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await save('check_out', { timestamp: now });
      setOutAt(now);
      setPhase('done');
    } catch {
      setError('Could not record check-out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // ── Styles ─────────────────────────────────────────────────────────────────
  const actionBtn = (color: string, bg: string): React.CSSProperties => ({
    width: '100%',
    padding: '13px 0',
    fontSize: 14,
    fontWeight: 700,
    borderRadius: 10,
    border: 'none',
    background: busy ? '#e5e7eb' : bg,
    color: busy ? '#9ca3af' : color,
    cursor: busy ? 'wait' : 'pointer',
    transition: 'all 0.15s',
    letterSpacing: 0.3,
  });

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 13,
    fontWeight: 600,
    color: '#111827',
    textAlign: 'right',
  };

  const coordStyle: React.CSSProperties = {
    fontSize: 10,
    color: '#9ca3af',
    textAlign: 'right',
    marginTop: 1,
  };

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 10 }}>
        ⏱ Time &amp; Travel Log
      </div>

      {/* Log rows — show entries that have been recorded */}
      <div style={{ marginBottom: 12 }}>
        {travel.timestamp && (
          <div style={rowStyle}>
            <div>
              <div style={labelStyle}>🚗 Left for Site</div>
              {coordLabel(travel.lat, travel.lng) && (
                <div style={coordStyle}>{coordLabel(travel.lat, travel.lng)}</div>
              )}
            </div>
            <div>
              <div style={valueStyle}>{fmtTime(travel.timestamp)}</div>
              {arrived.timestamp && (
                <div style={coordStyle}>Travel: {fmtDuration(travel.timestamp!, arrived.timestamp)}</div>
              )}
            </div>
          </div>
        )}

        {arrived.timestamp && (
          <div style={rowStyle}>
            <div>
              <div style={labelStyle}>📍 Arrived on Site</div>
              {coordLabel(arrived.lat, arrived.lng) && (
                <div style={coordStyle}>{coordLabel(arrived.lat, arrived.lng)}</div>
              )}
            </div>
            <div style={valueStyle}>{fmtTime(arrived.timestamp)}</div>
          </div>
        )}

        {inAt && (
          <div style={rowStyle}>
            <div style={labelStyle}>▶️ Work Started</div>
            <div style={valueStyle}>{fmtTime(inAt)}</div>
          </div>
        )}

        {outAt && (
          <div style={{ ...rowStyle, borderBottom: 'none' }}>
            <div>
              <div style={labelStyle}>⏹ Work Ended</div>
              {inAt && (
                <div style={coordStyle}>On-site: {fmtDuration(inAt, outAt)}</div>
              )}
            </div>
            <div style={valueStyle}>{fmtTime(outAt)}</div>
          </div>
        )}

        {phase === 'idle' && (
          <div style={{ fontSize: 12, color: '#9ca3af', padding: '6px 0' }}>
            No time recorded yet. Tap a button below when ready.
          </div>
        )}
      </div>

      {/* Action button — one at a time, advances the phase */}
      {phase === 'idle' && (
        <button onClick={handleOnMyWay} disabled={busy} style={actionBtn('white', '#0D7377')}>
          {busy ? '…' : '🚗  On My Way'}
        </button>
      )}

      {phase === 'traveling' && (
        <button onClick={handleArrived} disabled={busy} style={actionBtn('white', '#1D4ED8')}>
          {busy ? '…' : '📍  I\'ve Arrived'}
        </button>
      )}

      {phase === 'arrived' && (
        <button onClick={handleCheckIn} disabled={busy} style={actionBtn('white', '#047857')}>
          {busy ? '…' : '▶️  Start Work'}
        </button>
      )}

      {phase === 'working' && (
        <button onClick={handleCheckOut} disabled={busy} style={actionBtn('white', '#B45309')}>
          {busy ? '…' : '⏹  End Work'}
        </button>
      )}

      {phase === 'done' && (
        <div style={{
          textAlign: 'center',
          padding: '10px',
          background: 'rgba(4,120,87,0.07)',
          borderRadius: 8,
          border: '1px solid rgba(4,120,87,0.2)',
          fontSize: 13,
          fontWeight: 700,
          color: '#047857',
        }}>
          ✅ Job complete — time recorded
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{error}</div>
      )}
  
    </div>
  );
}
