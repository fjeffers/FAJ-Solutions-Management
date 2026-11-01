// The hotel for a job (Fred, 2026-11-01: "i need to add hotel info in the home page on the tech
// app"). The office fills it in on the work order (work_orders.hotel, migration 152); the tech
// sees it on his home screen with Navigate and Call while the stay is current or coming up.

export type Hotel = { name: string; address: string; phone: string; confirmation: string; checkIn: string; checkOut: string; notes: string };

export const EMPTY_HOTEL: Hotel = { name: '', address: '', phone: '', confirmation: '', checkIn: '', checkOut: '', notes: '' };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v: unknown) => { const d = str(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; };

/** A saved hotel (or anything) made safe; null when there's nothing to show. */
export function parseHotel(raw: unknown): Hotel | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const h: Hotel = {
    name: str(r.name, 120), address: str(r.address, 300), phone: str(r.phone, 40), confirmation: str(r.confirmation, 80),
    checkIn: day(r.check_in ?? r.checkIn), checkOut: day(r.check_out ?? r.checkOut), notes: str(r.notes, 1000),
  };
  return hasHotel(h) ? h : null;
}

export const hasHotel = (h: Hotel | null | undefined): h is Hotel => !!h && !!(h.name || h.address || h.confirmation);

/** What the work order stores. */
export function hotelToDb(h: Hotel): Record<string, string> | null {
  if (!hasHotel(h)) return null;
  return { name: h.name.trim(), address: h.address.trim(), phone: h.phone.trim(), confirmation: h.confirmation.trim(),
    check_in: h.checkIn, check_out: h.checkOut, notes: h.notes.trim() };
}

type Job = { id: string; hotel?: Hotel | null };

/** The hotels a tech should see today: stays not over yet, soonest first, each hotel once. */
export function currentHotels<T extends Job>(jobs: readonly T[], today: string): { hotel: Hotel; job: T }[] {
  const seen = new Set<string>();
  return jobs
    .filter((j) => hasHotel(j.hotel) && (!j.hotel!.checkOut || j.hotel!.checkOut >= today))
    .map((j) => ({ hotel: j.hotel!, job: j }))
    .sort((a, b) => (a.hotel.checkIn || '0000').localeCompare(b.hotel.checkIn || '0000'))
    .filter(({ hotel }) => {
      const k = `${hotel.name.toLowerCase()}|${hotel.address.toLowerCase()}|${hotel.checkIn}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/** "Sun, Nov 2" */
export const hotelDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
