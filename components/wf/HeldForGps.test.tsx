// @vitest-environment jsdom
//
// A picture with no GPS isn't sent (Fred, 2026-10-27: "Geo tag on every
// picture"), and isn't thrown away either (Greptile on PR #28): it is held with
// a Send again, and goes once Location is on.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { WfJob } from '@/lib/wf';

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toastError, toastSuccess, toastInfo: vi.fn() }));
// The stamp draws on a canvas, which the test browser hasn't got.
vi.mock('@/lib/photo-stamp', () => ({ stampPhoto: async () => new Blob(['jpeg'], { type: 'image/jpeg' }), shrinkPhoto: async () => new Blob(['s']) }));
let here: { latitude: number; longitude: number; accuracy: number } | null = null;
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
  getCurrentPosition: (ok: (p: unknown) => void, fail: (e: { code: number }) => void) => (here ? ok({ coords: here }) : fail({ code: 1 })),
} });

const { HeldForGps } = await import('./NoGps');
const { default: CheckInDialog } = await import('./CheckIn');
afterEach(() => { cleanup(); toastError.mockClear(); toastSuccess.mockClear(); here = null; });

describe('a picture held for want of GPS', () => {
  it('says why, how to turn Location on, and offers Send again or Discard', () => {
    const onRetry = vi.fn(); const onDiscard = vi.fn();
    render(<HeldForGps onRetry={onRetry} onDiscard={onDiscard} />);
    expect(screen.getByRole('alert').textContent).toMatch(/Photo not sent: no GPS right now/);
    expect(screen.getByRole('alert').textContent).toMatch(/The photo is kept here until then/);
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it("Check in's photo is kept when there's no GPS, and sends on Send again once there is", async () => {
    const keep = vi.fn(async () => 'sent' as const);
    const job = { number: '19101414', capture: [], startAsks: [{ id: 'front', label: 'Front of the store', kind: 'photo' }] } as unknown as WfJob;
    render(<CheckInDialog job={job} startOfDay from={null} onClose={vi.fn()}
      send={{ startDrive: async () => true, arriveOnSite: async () => true, keep, note: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: /I'm on site/ }));
    const input = await waitFor(() => {
      const el = document.querySelector('input[type=file]');
      if (!el) throw new Error('no photo input yet');
      return el as HTMLInputElement;
    });
    fireEvent.change(input, { target: { files: [new File(['x'], 'front.jpg', { type: 'image/jpeg' })] } });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(keep).not.toHaveBeenCalled();
    here = { latitude: 40.7, longitude: -75.3, accuracy: 12 };
    fireEvent.click(screen.getByRole('button', { name: 'Send again' }));
    await waitFor(() => expect(keep).toHaveBeenCalledTimes(1));
    expect((keep.mock.calls[0] as unknown[])[3]).toEqual({ lat: 40.7, lng: -75.3, accuracy: 12 });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
