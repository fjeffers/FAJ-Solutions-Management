'use client';
import { useEffect, useState } from 'react';
import type { TimeLog } from '@/lib/types';
import { mapLink } from '@/lib/geo';

interface Props {
  woId: string | undefined;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDuration(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return '—';
  const mins = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
  if (mins < 0) return '—';
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function fmtCoord(lat: number | null | undefined, lng: number | null | undefined): string {
  if (lat == null || lng == null) return '—';
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/** A tappable map pin for a GPS fix (migration-100), or nothing. */
function gpsLink(lat: number | null | undefined, lng: number | null | undefined, acc?: number | null): React.ReactNode {
  if (lat == null || lng == null) return undefined;
  return (
    <a href={mapLink(lat, lng)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
      📍 {lat.toFixed(5)}, {lng.toFixed(5)}{acc != null ? ` (±${Math.round(acc)} m)` : ''}
    </a>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: value === '—' ? '#d1d5db' : '#111827' }}>{value}</div>
        {sub && <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ContractorCard({ log }: { log: TimeLog }) {
  const travelDur  = fmtDuration(log.travel_start_at, log.arrived_at);
  const onsiteDur  = fmtDuration(log.checked_in_at, log.checked_out_at);
  const totalDur   = fmtDuration(log.travel_start_at, log.checked_out_at);

  const hasAnyData =
    log.travel_start_at || log.arrived_at || log.checked_in_at || log.checked_out_at;

  return (
    <div style={{
      border: '1.5px solid #e5e7eb',
      borderRadius: 12,
      overflow: 'hidden',
      background: '#fff',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        background: '#f9fafb',
        borderBottom: '1px solid #e5e7eb',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 28, height: 28,
          borderRadius: '50%',
          background: 'var(--teal, #0E1B2E)',
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700,
          flexShrink: 0,
        }}>
          {log.contractor_name.charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{log.contractor_name}</div>
          <div style={{ fontSize: 10, color: '#9ca3af' }}>WO #{log.wo_number}</div>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '4px 14px 10px' }}>
        {!hasAnyData ? (
          <div style={{ fontSize: 12, color: '#9ca3af', padding: '12px 0', textAlign: 'center' }}>
            No time recorded yet
          </div>
        ) : (
          <>
            <Row
              label="🚗 Left for Site"
              value={fmtTime(log.travel_start_at)}
              sub={fmtCoord(log.travel_start_lat, log.travel_start_lng)}
            />
            <Row
              label="📍 Arrived"
              value={fmtTime(log.arrived_at)}
              sub={fmtCoord(log.arrived_lat, log.arrived_lng)}
            />
            <Row
              label="🚗 Travel Time"
              value={travelDur}
            />
            <Row
              label="▶️ Work Started"
              value={fmtTime(log.checked_in_at)}
              sub={gpsLink(log.checked_in_lat, log.checked_in_lng, log.checked_in_accuracy)}
            />
            <Row
              label="⏹ Work Ended"
              value={fmtTime(log.checked_out_at)}
              sub={gpsLink(log.checked_out_lat, log.checked_out_lng, log.checked_out_accuracy)}
            />
            <Row
              label="⏱ On-Site Time"
              value={onsiteDur}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0 2px', marginTop: 4, borderTop: '2px solid #f3f4f6' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.4 }}>Total Time</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: totalDur === '—' ? '#d1d5db' : '#0E1B2E' }}>{totalDur}</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function WOTimeLogs({ woId }: Props) {
  const [logs, setLogs]     = useState<TimeLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!woId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/wo-time-logs?wo_id=${woId}`)
      .then((r) => {
        if (!r.ok) throw new Error('Failed to load');
        return r.json();
      })
      .then((data) => setLogs(data))
      .catch(() => setError('Could not load time logs.'))
      .finally(() => setLoading(false));
  }, [woId]);

  if (!woId) return null;

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 13 }}>
        Loading time logs…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0', color: '#dc2626', fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        ⏱ Contractor Time Logs
      </div>

      {logs.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '32px 0',
          color: '#aaa',
          fontSize: 13,
          border: '1.5px dashed #e5e7eb',
          borderRadius: 12,
        }}>
          No time logs recorded for this work order yet.
        </div>
      ) : (
        <>
          {/* Summary row when multiple contractors */}
          {logs.length > 1 && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${Math.min(logs.length, 3)}, 1fr)`,
              gap: 10,
            }}>
              {logs.map((log) => {
                const dur = fmtDuration(log.checked_in_at, log.checked_out_at);
                return (
                  <div key={log.id} style={{
                    padding: '10px 12px',
                    background: '#f9fafb',
                    borderRadius: 10,
                    border: '1.5px solid #e5e7eb',
                    textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, marginBottom: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {log.contractor_name}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: dur === '—' ? '#d1d5db' : '#0E1B2E' }}>
                      {dur}
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>on-site</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Individual cards */}
          {logs.map((log) => (
            <ContractorCard key={log.id} log={log} />
          ))}
        </>
      )}
    </div>
  );
}
