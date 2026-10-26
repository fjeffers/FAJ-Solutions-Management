// @vitest-environment jsdom
//
// The office adding a tech's odometer picture to a day by hand, when the app
// was down (Fred, 2026-10-26): the AI reads the miles off the picture and the
// time comes from the photo itself, and the office checks both before Add.
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
let takenAt: string | null = '2026-10-26T11:31:05.000Z';
vi.mock('@/lib/photo-time', () => ({ photoTakenAt: async () => ({ at: takenAt, from: takenAt ? 'camera' : null, gps: null }) }));

const sent: { url: string; form: Record<string, string> }[] = [];
let aiReading: number | null = 142180.4;
/** Holds the next AI reply until released: a slow read. */
let hold: Promise<void> | null = null;
vi.stubGlobal('fetch', async (url: string, init: { body: FormData }) => {
  const form: Record<string, string> = {};
  init.body.forEach((v, k) => { form[k] = typeof v === 'string' ? v : 'file'; });
  sent.push({ url, form });
  const reading = aiReading;
  if (url === '/api/jobs/read-photo' && hold) { const h = hold; hold = null; await h; }
  const body = url === '/api/jobs/read-photo' ? { ok: true, source: 'ai', result: { reading } } : { ok: true };
  return { ok: true, json: async () => body };
});

const { default: DayPictures } = await import('./DayPictures');
const pic = () => new File(['x'], 'odo.jpg', { type: 'image/jpeg' });
afterEach(() => { cleanup(); sent.length = 0; stampPhoto.mockClear(); toastError.mockClear(); toastSuccess.mockClear(); takenAt = '2026-10-26T11:31:05.000Z'; aiReading = 142180.4; });

const open = (onAdded = vi.fn()) => {
  render(<DayPictures pics={[]} woId="wo-1" woNumber="19101414" day="2026-10-26" tech="Paul Gibbs" onAdded={onAdded} />);
  fireEvent.click(screen.getByRole('button', { name: /Odometer end/ }));
  fireEvent.change(screen.getByLabelText('Picture for Paul Gibbs 2026-10-26'), { target: { files: [pic()] } });
  return onAdded;
};

describe("adding a tech's odometer picture from the office", () => {
  it('fills the miles the AI read and the time the photo was taken, then adds both', async () => {
    const onAdded = open();
    const miles = screen.getByLabelText('Odometer end reading Paul Gibbs 2026-10-26') as HTMLInputElement;
    await waitFor(() => expect(miles.value).toBe('142180.4'));
    expect((screen.getByLabelText('Odometer end time Paul Gibbs 2026-10-26') as HTMLInputElement).value).toBe('07:31');
    expect(screen.getByText(/Read from the photo, with the time it was taken/)).toBeTruthy();
    expect(sent[0]).toEqual({ url: '/api/jobs/read-photo', form: { wo_id: 'wo-1', file: 'file' } });
    // The office corrects the reading before Add; what the AI read is kept beside it.
    fireEvent.change(miles, { target: { value: '142,180' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith({ moment: 'end', reading: 142180 }));
    expect(sent[1]).toEqual({ url: '/api/jobs/day-photo', form: {
      wo_id: 'wo-1', day: '2026-10-26', tech: 'Paul Gibbs', kind: 'odo_end', reading: '142180', ai_reading: '142180.4', time: '07:31', file: 'file',
    } });
    expect(stampPhoto.mock.calls[0][1]).toEqual(['WO 19101414 · Paul Gibbs', 'Mon, Oct 26, 7:31 AM · Odometer end 142,180', 'Added by the office']);
  });

  it("a slow read of an earlier picture never fills in the next one's miles (Greptile on PR #27)", async () => {
    let release!: () => void;
    hold = new Promise<void>((r) => { release = r; });
    aiReading = 1000;
    open();
    await waitFor(() => expect(sent).toHaveLength(1));
    // The office starts on another picture, and the first one's reply lands while it is choosing.
    fireEvent.click(screen.getByRole('button', { name: /Odometer end/ }));
    release();
    await new Promise((r) => setTimeout(r, 20));
    aiReading = 2000;
    fireEvent.change(screen.getByLabelText('Picture for Paul Gibbs 2026-10-26'), { target: { files: [pic()] } });
    const miles = screen.getByLabelText('Odometer end reading Paul Gibbs 2026-10-26') as HTMLInputElement;
    await waitFor(() => expect(sent).toHaveLength(2));
    await waitFor(() => expect(miles.value).toBe('2000'));
  });

  it("says so when the photo is from another day, and leaves the miles to type when the AI can't read them", async () => {
    takenAt = '2026-10-25T22:10:00.000Z';
    aiReading = null;
    open();
    await waitFor(() => expect(screen.getByText(/The time is from the photo. Type the miles shown./)).toBeTruthy());
    expect(screen.getByText(/This photo was taken on Sun, Oct 25, not Mon, Oct 26./)).toBeTruthy();
    expect((screen.getByLabelText('Odometer end reading Paul Gibbs 2026-10-26') as HTMLInputElement).value).toBe('');
  });
});
