// @vitest-environment jsdom
//
// Adding pictures to a job from the office (Fred, 2026-10-26: "still unable to
// download photo or add them"): each picture picked goes to the job's photos on
// the day and under the name chosen, stamped like a tech's.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toastError, toastSuccess, toastInfo: vi.fn() }));
// The stamp draws on a canvas, which the test browser hasn't got.
const stampPhoto = vi.fn<(f: Blob, lines: string[]) => Promise<Blob>>(async () => new Blob(['jpeg'], { type: 'image/jpeg' }));
vi.mock('@/lib/photo-stamp', () => ({ stampPhoto: (f: Blob, lines: string[]) => stampPhoto(f, lines) }));

const sent: Record<string, string>[] = [];
let answers: { ok: boolean; error?: string }[] = [];
vi.stubGlobal('fetch', async (_url: string, init: { body: FormData }) => {
  const f: Record<string, string> = {};
  init.body.forEach((v, k) => { f[k] = typeof v === 'string' ? v : `file:${(v as File).type}`; });
  sent.push(f);
  const a = answers.shift() ?? { ok: true };
  return { ok: a.ok, json: async () => a };
});

const { default: AddJobPhotos } = await import('./AddJobPhotos');
const pic = (name: string) => new File(['x'], name, { type: 'image/jpeg' });
afterEach(() => { cleanup(); sent.length = 0; answers = []; stampPhoto.mockClear(); toastError.mockClear(); toastSuccess.mockClear(); });

describe('Add photos', () => {
  it('adds every picture picked to the job, on the day and under the name chosen', async () => {
    const onAdded = vi.fn();
    render(<AddJobPhotos woId="wo" woNumber="19101401" techs={['Paul Gibbs', 'Raja']} day="2026-10-19" onAdded={onAdded} />);
    fireEvent.change(screen.getByLabelText('Pictures to add to the job'), { target: { files: [pic('a.jpg'), pic('b.jpg')] } });
    expect(screen.getByText('2 pictures')).toBeTruthy();
    expect((screen.getByLabelText('Whose pictures') as HTMLSelectElement).value).toBe('Paul Gibbs');
    expect([...(screen.getByLabelText('Whose pictures') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['Paul Gibbs', 'Raja', 'Office']);
    fireEvent.change(screen.getByLabelText('Day the pictures are from'), { target: { value: '2026-10-21' } });
    fireEvent.change(screen.getByLabelText('Whose pictures'), { target: { value: 'Raja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to the job' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      { wo_id: 'wo', day: '2026-10-21', tech: 'Raja', kind: 'site', file: 'file:image/jpeg' },
      { wo_id: 'wo', day: '2026-10-21', tech: 'Raja', kind: 'site', file: 'file:image/jpeg' },
    ]);
    expect(stampPhoto.mock.calls[0][1]).toEqual(['WO 19101401 · Raja', 'Wed, Oct 21', 'Added by the office']);
    expect(toastSuccess).toHaveBeenCalledWith('2 pictures added to Wed, Oct 21.');
    expect(screen.queryByRole('button', { name: 'Add to the job' })).toBeNull();
  });

  it('keeps the pictures not added picked, to try again, and says why', async () => {
    answers = [{ ok: true }, { ok: false, error: 'That picture is too large.' }];
    const onAdded = vi.fn();
    render(<AddJobPhotos woId="wo" woNumber="19101401" techs={[]} day="2026-10-19" onAdded={onAdded} />);
    fireEvent.change(screen.getByLabelText('Pictures to add to the job'), { target: { files: [pic('a.jpg'), pic('b.jpg'), pic('c.jpg')] } });
    expect((screen.getByLabelText('Whose pictures') as HTMLSelectElement).value).toBe('Office');
    fireEvent.click(screen.getByRole('button', { name: 'Add to the job' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(sent).toHaveLength(2);
    expect(toastError).toHaveBeenCalledWith('That picture is too large.');
    expect(toastSuccess).toHaveBeenCalledWith('1 picture added to Mon, Oct 19.');
    expect(screen.getByText('2 pictures')).toBeTruthy();
  });
});
