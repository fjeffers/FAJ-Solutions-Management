import { describe, expect, it } from 'vitest';
import { EMPTY_HOTEL, currentHotels, hotelDriveDay, hotelToDb, parseHotel } from './hotel';

describe('Hotel on a job', () => {
  it('reads what the work order stores and drops junk', () => {
    expect(parseHotel({ name: ' Hampton Inn ', address: '1 Main St', check_in: '2026-11-02', check_out: 'soon' }))
      .toEqual({ ...EMPTY_HOTEL, name: 'Hampton Inn', address: '1 Main St', checkIn: '2026-11-02' });
    expect(parseHotel({ phone: '555' })).toBeNull();
    expect(parseHotel(null)).toBeNull();
  });

  it('stores nothing for an empty hotel, and round-trips a filled one', () => {
    expect(hotelToDb(EMPTY_HOTEL)).toBeNull();
    const h = { ...EMPTY_HOTEL, name: 'Hampton Inn', confirmation: 'ABC123', checkIn: '2026-11-02', checkOut: '2026-11-06' };
    expect(parseHotel(hotelToDb(h))).toEqual(h);
  });

  it('shows stays not over yet, soonest first, each hotel once', () => {
    const hampton = { ...EMPTY_HOTEL, name: 'Hampton Inn', address: '1 Main St', checkIn: '2026-11-02', checkOut: '2026-11-06' };
    const jobs = [
      { id: 'a', hotel: { ...EMPTY_HOTEL, name: 'Old', checkIn: '2026-10-20', checkOut: '2026-10-25' } },
      { id: 'b', hotel: hampton },
      { id: 'c', hotel: { ...hampton } },
      { id: 'd', hotel: { ...EMPTY_HOTEL, name: 'Marriott', checkIn: '2026-11-01', checkOut: '2026-11-01' } },
      { id: 'e', hotel: null },
    ];
    expect(currentHotels(jobs, '2026-11-01').map((x) => x.job.id)).toEqual(['d', 'b']);
  });

  it("knows Sunday's drive out to the hotel for a Monday start", () => {
    const hotel = { ...EMPTY_HOTEL, name: 'Hampton Inn', address: '1 Main St', checkIn: '2026-11-01' };
    expect(hotelDriveDay({ id: 'a', date: '2026-11-02', hotel }, '2026-11-01')).toBe(true);
    expect(hotelDriveDay({ id: 'a', date: '2026-11-02', hotel }, '2026-10-31')).toBe(false);
    // The job's own days are work days, not the drive out.
    expect(hotelDriveDay({ id: 'a', date: '2026-11-01', hotel }, '2026-11-01')).toBe(false);
    // No check-in date: the day before the job.
    const undated = { ...hotel, checkIn: '' };
    expect(hotelDriveDay({ id: 'a', date: '2026-11-02', hotel: undated }, '2026-11-01')).toBe(true);
    expect(hotelDriveDay({ id: 'a', date: '2026-11-03', hotel: undated }, '2026-11-01')).toBe(false);
    expect(hotelDriveDay({ id: 'a', date: '2026-11-02', hotel: null }, '2026-11-01')).toBe(false);
  });
});
