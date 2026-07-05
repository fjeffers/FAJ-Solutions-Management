'use client';
import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { MapPin, Navigation, Radio } from 'lucide-react';
import { STATUS_COLORS } from '@/lib/utils';
import type { Contractor, EnrichedWorkOrder, WorkOrder, ContractorTimeLog } from '@/lib/types';

// react-leaflet touches `window` on import, so it must never render during SSR.
const MapInner = dynamic(() => import('./DispatchMapInner'), { ssr: false, loading: () => <MapLoading /> });

function MapLoading() {
  return (
    <div style={{ height: 520, borderRadius: 12, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13 }}>
      Loading map…
    </div>
  );
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type MapWO = EnrichedWorkOrder & { site_lat: number; site_lng: number };
export type LiveContractor = { contractor: Contractor; lat: number; lng: number; at: string };

export default function DispatchMapView({
  workOrders,
  contractors,
  contractorTimeLogs,
  onUpdateWO,
}: {
  workOrders: EnrichedWorkOrder[];
  contractors: Contractor[];
  contractorTimeLogs: ContractorTimeLog[];
  onUpdateWO: (id: string, patch: Partial<WorkOrder>) => void;
}) {
  const [selectedWO, setSelectedWO] = useState<string | null>(null);

  const activeWOs = useMemo(
    () => workOrders.filter((w) => w.wo_status !== 'Paid' && !w.archived_at),
    [workOrders],
  );

  const mappedWOs: MapWO[] = useMemo(
    () => activeWOs.filter((w): w is MapWO => w.site_lat != null && w.site_lng != null),
    [activeWOs],
  );

  const unmappedCount = activeWOs.length - mappedWOs.length;

  // Most recent known position per contractor (arrived > travel start), regardless of WO status.
  const liveContractors: LiveContractor[] = useMemo(() => {
    const latest = new Map<string, ContractorTimeLog>();
    for (const log of contractorTimeLogs) {
      const existing = latest.get(log.contractor_name);
      if (!existing || new Date(log.updated_at) > new Date(existing.updated_at)) {
        latest.set(log.contractor_name, log);
      }
    }
    const result: LiveContractor[] = [];
    for (const [name, log] of latest) {
      const lat = log.arrived_lat ?? log.travel_start_lat;
      const lng = log.arrived_lng ?? log.travel_start_lng;
      const at = log.arrived_at ?? log.travel_start_at;
      if (lat == null || lng == null || !at) continue;
      const contractor = contractors.find((c) => c.name === name);
      if (!contractor) continue;
      result.push({ contractor, lat, lng, at });
    }
    return result;
  }, [contractorTimeLogs, contractors]);

  const selected = mappedWOs.find((w) => w.id === selectedWO) ?? null;

  const nearbyContractors = useMemo(() => {
    if (!selected) return [];
    return liveContractors
      .map((lc) => ({ ...lc, miles: haversineMiles(selected.site_lat, selected.site_lng, lc.lat, lc.lng) }))
      .sort((a, b) => a.miles - b.miles);
  }, [selected, liveContractors]);

  return (
    <div className="view-inner" style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="display" style={{ fontSize: 11, color: 'var(--teal)', letterSpacing: 3, marginBottom: 6 }}>DISPATCH</div>
        <h1 className="serif" style={{ fontSize: 36, fontWeight: 600, margin: 0, lineHeight: 1 }}>Dispatch Map</h1>
        <p style={{ margin: '6px 0 0', color: '#666', fontSize: 14 }}>
          {mappedWOs.length} location{mappedWOs.length !== 1 ? 's' : ''} mapped · {liveContractors.length} contractor{liveContractors.length !== 1 ? 's' : ''} tracked
          {unmappedCount > 0 && ` · ${unmappedCount} not yet geocoded`}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 300px' : '1fr', gap: 20 }}>
        <div className="glass card" style={{ padding: 0, overflow: 'hidden' }}>
          {mappedWOs.length === 0 ? (
            <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 13, flexDirection: 'column', gap: 8 }}>
              <MapPin size={28} color="#ccc" />
              No work orders geocoded yet — save a work order with a site address to plot it here.
            </div>
          ) : (
            <MapInner
              workOrders={mappedWOs}
              liveContractors={liveContractors}
              selectedId={selectedWO}
              onSelect={setSelectedWO}
            />
          )}
        </div>

        {selected && (
          <div className="glass card">
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--teal)', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
              WO #{selected.wo_number}
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{selected.title || 'Untitled'}</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{selected.site_address}</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 16 }}>
              Currently: <strong>{selected.contractor_name || 'Unassigned'}</strong>
            </div>

            <div style={{ fontSize: 11, fontWeight: 700, color: '#888', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 }}>
              Assign Nearby Contractor
            </div>
            {nearbyContractors.length === 0 ? (
              <div style={{ fontSize: 12, color: '#bbb' }}>No live contractor locations available.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {nearbyContractors.map((nc) => (
                  <button
                    key={nc.contractor.id}
                    onClick={() => {
                      const patch: Partial<WorkOrder> = { contractor_name: nc.contractor.name };
                      if (selected.wo_status === 'Open') patch.wo_status = 'Assigned';
                      onUpdateWO(selected.id, patch);
                      setSelectedWO(null);
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '8px 12px', borderRadius: 8, border: nc.miles <= 25 ? '1px solid rgba(13,115,119,0.3)' : '1px solid #eee',
                      background: nc.miles <= 25 ? 'rgba(13,115,119,0.05)' : '#fafafa', cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600 }}>
                      <Navigation size={12} color={nc.miles <= 25 ? 'var(--teal)' : '#999'} /> {nc.contractor.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#999' }}>{nc.miles.toFixed(0)} mi</span>
                  </button>
                ))}
              </div>
            )}
            <button className="btn btn-ghost" style={{ width: '100%', marginTop: 12, fontSize: 12 }} onClick={() => setSelectedWO(null)}>Close</button>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap', fontSize: 11, color: '#888' }}>
        {(Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]).map((s) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLORS[s].color, display: 'inline-block' }} /> {s}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <Radio size={11} color="#4338ca" /> Live contractor
        </span>
      </div>
    </div>
  );
}
