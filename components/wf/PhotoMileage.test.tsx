// @vitest-environment jsdom
//
// A mileage photo picked from the phone later (Fred, 2026-10-26: "if I take a
// picture on my phone and then upload later on ... the app should basically ask
// them whether ... ending, or starting mileage"): the AI says it's the odometer
// and reads it, the tech says starting or ending, and it is saved at the time
// the photo was taken.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toastError, toastSuccess, toastInfo: vi.fn() }));
// The stamp draws on a canvas, which the test browser hasn't got.
const stampPhoto = vi.fn<(f: Blob, lines: string[]) => Promise<Blob>>(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
vi.mock('@/lib/photo-stamp', () => ({
  stampPhoto: (f: Blob, lines: string[]) => stampPhoto(f, lines),
  shrinkPhoto: async () => new Blob(['small'], { type: 'image/jpeg' }),
}));
vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: () => {} }));

const sent: { url: string; form: Record<string, string> }[] = [];
let answer: (url: string) => { ok: boolean; body: unknown } = () => ({ ok: true, body: { ok: true } });
vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
  const form: Record<string, string> = {};
  init.body.forEach((v, k) => { form[k] = typeof v === 'string' ? v : 'file'; });
  sent.push({ url, form });
  const a = answer(url);
  return { ok: a.ok, json: async () => a.body };
});

const { PhotoMileageDialog, sortPhonePhoto } = await import('./Odometer');
const NOW = Date.parse('2026-10-26T23:00:00Z');
const pic = () => new File(['x'], 'odo.jpg', { type: 'image/jpeg' });
afterEach(() => {
  cleanup(); sent.length = 0; stampPhoto.mockClear(); toastError.mockClear(); toastSuccess.mockClear();
  answer = () => ({ ok: true, body: { ok: true } });
});

describe('a mileage photo from the phone', () => {
  it('asks starting or ending, then saves the reading at the time the photo was taken', async () => {
    const keep = vi.fn(); const onClose = vi.fn();
    render(<PhotoMileageDialog woNumber="19101414" file={pic()} now={NOW} keep={keep} onNotMileage={vi.fn()} onClose={onClose}
      photo={{ what: 'odometer', sure: true, read: 48213.6, taken: { at: '2026-10-26T11:31:05.000Z', from: 'camera', gps: null } }} />);
    expect(screen.getByText('48,213.6')).toBeTruthy();
    expect(screen.getByText('Taken Mon, Oct 26, 7:31 AM')).toBeTruthy();
    const send = screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Ending mileage' }));
    fireEvent.click(send);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent).toEqual([{ url: '/api/tech/odometer', form: {
      wo_number: '19101414', at: '2026-10-26T11:31:05.000Z', moment: 'end', reading: '48213.6', ai_reading: '48213.6', file: 'file',
    } }]);
    expect(stampPhoto.mock.calls[0][1]).toEqual(['FAJ Solutions · WO 19101414 · Ending mileage, added later', 'Mon, Oct 26, 2026 · 7:31:05 AM EDT', 'GPS: location not available']);
    expect(keep).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Ending mileage sent: 48,213.6.');
  });

  it("keeps the photo's own GPS when it has one", async () => {
    const onClose = vi.fn();
    render(<PhotoMileageDialog woNumber="19101414" file={pic()} now={NOW} keep={vi.fn()} onNotMileage={vi.fn()} onClose={onClose}
      photo={{ what: 'odometer', sure: true, read: 1200, taken: { at: '2026-10-26T11:31:05.000Z', from: 'camera', gps: { lat: 40.6884, lng: -75.2207, accuracy: null } } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Starting mileage' }));
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sent[0].form).toMatchObject({ moment: 'start', lat: '40.6884', lng: '-75.2207' });
  });

  it('over two days old, with no date, or unreadable: the photo goes to the office with what is known', async () => {
    const cases = [
      { taken: { at: '2026-10-23T12:00:00.000Z', from: 'camera' as const, gps: null }, read: 48213, label: /^Starting mileage 48,213 \(photo from Fri, Oct 23, 8:00 AM, for the office to add\)$/, why: /over two days old/ },
      { taken: { at: null, from: null, gps: null }, read: 48213, label: /^Starting mileage 48,213 \(no date on the photo, for the office to add\)$/, why: /no date/ },
      { taken: { at: '2026-10-26T11:31:05.000Z', from: 'camera' as const, gps: null }, read: null, label: /^Starting mileage \(photo from Mon, Oct 26, 7:31 AM, for the office to add\)$/, why: /Couldn't read the number/ },
    ];
    for (const c of cases) {
      const keep = vi.fn(async () => 'sent' as const); const onClose = vi.fn();
      render(<PhotoMileageDialog woNumber="19101414" file={pic()} now={NOW} keep={keep} onNotMileage={vi.fn()} onClose={onClose}
        photo={{ what: 'odometer', sure: true, read: c.read, taken: c.taken }} />);
      expect(screen.getByText(c.why)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Starting mileage' }));
      fireEvent.click(screen.getByRole('button', { name: /Send/ }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      expect(sent).toHaveLength(0);
      expect((keep.mock.calls[0] as unknown[])[1]).toMatch(c.label);
      cleanup();
    }
  });

  it('not a mileage photo after all: it goes with the job photos', () => {
    const onNotMileage = vi.fn();
    render(<PhotoMileageDialog woNumber="19101414" file={pic()} now={NOW} keep={vi.fn()} onNotMileage={onNotMileage} onClose={vi.fn()}
      photo={{ what: 'odometer', sure: false, read: null, taken: { at: null, from: null, gps: null } }} />);
    expect(screen.getByText('Is this a mileage photo?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Not a mileage photo' }));
    expect(onNotMileage).toHaveBeenCalled();
  });
});

describe('looking at a photo from the phone', () => {
  it('the odometer with its reading, anything else, or ask the tech when the AI is out of reach', async () => {
    answer = () => ({ ok: true, body: { ok: true, source: 'ai', result: { what: 'odometer', reading: 48213 } } });
    expect(await sortPhonePhoto('19101414', pic())).toMatchObject({ what: 'odometer', sure: true, read: 48213 });
    expect(sent[0]).toEqual({ url: '/api/tech/read-photo', form: { wo_number: '19101414', kind: 'sort', file: 'file' } });
    answer = () => ({ ok: true, body: { ok: true, source: 'ai', result: { what: 'other', reading: null } } });
    expect(await sortPhonePhoto('19101414', pic())).toMatchObject({ what: 'other' });
    answer = () => ({ ok: true, body: { ok: true, source: 'no-key', result: null } });
    expect(await sortPhonePhoto('19101414', pic())).toMatchObject({ what: 'odometer', sure: false, read: null });
    // It looked and said nothing: ask too, never file it as a job photo unasked (Greptile on PR #27).
    answer = () => ({ ok: true, body: { ok: true, source: 'unreadable', result: null } });
    expect(await sortPhonePhoto('19101414', pic())).toMatchObject({ what: 'odometer', sure: false, read: null });
  });
});
