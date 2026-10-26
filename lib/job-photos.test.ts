import { describe, expect, it } from 'vitest';
import { downloadHref, fileExt, photoFileName, photoDay } from './job-photos';

const pub = 'https://izr.supabase.co/storage/v1/object/public/portal-uploads/wo_1/photo_1.jpg';
const signed = 'https://izr.supabase.co/storage/v1/object/sign/job-receipts/1/r.jpg?token=abc';

describe('saving a job’s pictures', () => {
  it('asks Supabase Storage to send the picture as a download, with its name', () => {
    expect(downloadHref(pub, 'WO 19101401 Paul Gibbs.jpg')).toBe(`${pub}?download=WO%2019101401%20Paul%20Gibbs.jpg`);
    expect(downloadHref(signed, 'r.jpg')).toBe(`${signed}&download=r.jpg`);
  });

  it('leaves any other link as it is', () => {
    expect(downloadHref('https://example.com/a.jpg', 'a.jpg')).toBe('https://example.com/a.jpg');
  });

  it('names the file from its parts, without what a file name can’t have', () => {
    expect(photoFileName(['WO 19101401', 'Paul Gibbs', '10-21-2026', '2'])).toBe('WO 19101401 Paul Gibbs 10-21-2026 2.jpg');
    // A comma would split the name in the download's header.
    expect(photoFileName(['Materials, Lowe’s: $104.17', 'Odometer start: 41,200'])).toBe('Materials Lowe’s $104.17 Odometer start 41200.jpg');
    expect(photoFileName(['a,b:c'])).toBe('a-b-c.jpg');
    expect(photoFileName(['WO 19101401', null, 'Lodging/Quality Inn'], 'pdf')).toBe('WO 19101401 Lodging-Quality Inn.pdf');
    expect(photoFileName([])).toBe('photo.jpg');
  });
});

describe('a picture’s own kind of file', () => {
  it('comes from its link, so a PNG receipt saves as a PNG (Greptile on PR #23)', () => {
    expect(fileExt('https://izr.supabase.co/storage/v1/object/sign/job-receipts/1/r_2.PNG?token=a.b')).toBe('png');
    expect(fileExt(pub)).toBe('jpg');
    expect(fileExt('https://izr.supabase.co/storage/v1/object/sign/job-receipts/1/hotel.pdf?token=a')).toBe('pdf');
    expect(fileExt('https://example.com/photo', 'jpg')).toBe('jpg');
    expect(fileExt('https://example.com/file.exe')).toBe('jpg');
  });
});

describe('the day a picture the office adds goes on', () => {
  it('is today while the job is on, else its first day', () => {
    expect(photoDay('2026-10-19', '2026-10-23', '2026-10-21')).toBe('2026-10-21');
    expect(photoDay('2026-10-19', '2026-10-23', '2026-10-26')).toBe('2026-10-19');
    expect(photoDay('2026-10-30', '2026-10-31', '2026-10-26')).toBe('2026-10-30');
    expect(photoDay('2026-10-19', null, '2026-10-19')).toBe('2026-10-19');
    expect(photoDay(null, null, '2026-10-26')).toBe('2026-10-26');
  });
});
