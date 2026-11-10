import { describe, expect, it } from 'vitest';
import { isJobLogPhotoLabel, jobLogPhotoLabel, jobLogPhotoLabelKey } from './job-log-photo-label';

describe('job log photo labels', () => {
  it('keeps receipt companies with hotel and rental labels', () => {
    const id = 'photo-1';
    const rental = jobLogPhotoLabelKey('rental', id, 'Enterprise Rent-A-Car');
    expect(jobLogPhotoLabel([rental], id)).toEqual({ kind: 'rental', vendor: 'Enterprise Rent-A-Car' });
    expect(isJobLogPhotoLabel(rental, id)).toBe(true);
  });

  it('keeps older receipt and hotel labels working', () => {
    expect(jobLogPhotoLabel(['photo-1'], 'photo-1')).toEqual({ kind: 'receipt', vendor: null });
    expect(jobLogPhotoLabel(['hotel:photo-1'], 'photo-1')).toEqual({ kind: 'hotel', vendor: null });
  });
});
