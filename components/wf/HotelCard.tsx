'use client';
// The tech's hotel on his home screen (lib/hotel.ts): where he's staying for the jobs coming up,
// with Navigate (Google, Waze or Apple), Call and the confirmation number.
import { BedDouble, Phone } from 'lucide-react';
import { currentHotels, hotelDay } from '@/lib/hotel';
import type { WfJob } from '@/lib/wf';
import DirectionsButton from './Directions';

export default function HotelCard({ jobs, today, onOpen }: { jobs: WfJob[]; today: string; onOpen: (id: string) => void }) {
  const stays = currentHotels(jobs, today);
  if (stays.length === 0) return null;
  return (
    <section className="fs-card" aria-label="Your hotel" style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontSize: 17, display: 'flex', alignItems: 'center', gap: 8 }}><BedDouble size={18} /> {stays.length === 1 ? 'Your hotel' : 'Your hotels'}</h3>
      {stays.map(({ hotel, job }, i) => {
        const dates = [hotel.checkIn && `Check in ${hotelDay(hotel.checkIn)}`, hotel.checkOut && `check out ${hotelDay(hotel.checkOut)}`].filter(Boolean).join(' · ');
        return (
          <div key={`${job.id}-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: i ? 10 : 0, borderTop: i ? '1px solid var(--wf-line, #e5e7eb)' : undefined }}>
            <strong style={{ fontSize: 16 }}>{hotel.name || 'Hotel'}</strong>
            {dates && <span className="fs-meta">{dates}</span>}
            {hotel.address && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px', borderRadius: 12, border: '1px solid var(--wf-gold, #c9a24b)', background: 'var(--wf-gold-soft, #f6efdc)' }}>
                <small style={{ fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.04em' }}>Hotel address</small>
                <strong style={{ fontSize: 15, lineHeight: 1.35, overflowWrap: 'anywhere' }}>{hotel.address}</strong>
              </div>
            )}
            {hotel.confirmation && <span>Confirmation # <b style={{ letterSpacing: 0.5 }}>{hotel.confirmation}</b></span>}
            {hotel.notes && <span className="fs-meta" style={{ whiteSpace: 'pre-line' }}>{hotel.notes}</span>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {hotel.address && <DirectionsButton to={{ address: hotel.address }} label="Navigate to hotel" className="wf-btn wf-btn-gold" />}
              {hotel.phone && <a className="wf-btn wf-btn-outline" href={`tel:${hotel.phone.replace(/[^\d+]/g, '')}`}><Phone size={15} /> Call hotel</a>}
              <button type="button" className="wf-btn wf-btn-ghost" onClick={() => onOpen(job.id)}>WO {job.number}</button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
