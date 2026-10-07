'use client';
import { useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { STATUS_COLORS, fmtMoney } from '@/lib/utils';
import type { MapWO, LiveContractor } from './DispatchMapView';

function dotIcon(color: string, size = 16): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const CONTRACTOR_ICON = dotIcon('#4338ca', 14);

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 11);
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 13 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)]);
  return null;
}

export default function DispatchMapInner({
  workOrders,
  liveContractors,
  selectedId,
  onSelect,
}: {
  workOrders: MapWO[];
  liveContractors: LiveContractor[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const points: [number, number][] = [
    ...workOrders.map((w) => [w.site_lat, w.site_lng] as [number, number]),
    ...liveContractors.map((c) => [c.lat, c.lng] as [number, number]),
  ];
  const center: [number, number] = points[0] ?? [39.8283, -98.5795]; // fallback: center of US

  return (
    <MapContainer center={center} zoom={10} style={{ height: 520, width: '100%' }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {workOrders.map((w) => {
        const color = (STATUS_COLORS[w.wo_status] ?? STATUS_COLORS['Open']).color;
        const isSelected = w.id === selectedId;
        return (
          <Marker
            key={w.id}
            position={[w.site_lat, w.site_lng]}
            icon={dotIcon(color, isSelected ? 22 : 16)}
            eventHandlers={{ click: () => onSelect(w.id) }}
          >
            <Popup>
              <div style={{ fontSize: 12, minWidth: 140 }}>
                <div style={{ fontWeight: 700, color: 'var(--teal)' }}>WO #{w.wo_number}</div>
                <div style={{ fontWeight: 600 }}>{w.title || 'Untitled'}</div>
                <div style={{ color: '#666' }}>{w.contractor_name || 'Unassigned'}</div>
                <div style={{ color: '#888' }}>{fmtMoney(Number(w.total_amount))} · {w.wo_status}</div>
              </div>
            </Popup>
          </Marker>
        );
      })}
      {liveContractors.map((c) => (
        <Marker key={c.contractor.id} position={[c.lat, c.lng]} icon={CONTRACTOR_ICON}>
          <Popup>
            <div style={{ fontSize: 12 }}>
              <div style={{ fontWeight: 700 }}>{c.contractor.name}</div>
              <div style={{ color: '#888' }}>{c.what ?? 'Last seen'}{c.woNumber ? ` · WO ${c.woNumber}` : ''}</div>
              <div style={{ color: '#888' }}>{new Date(c.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
