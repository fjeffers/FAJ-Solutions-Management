import { describe, it, expect } from 'vitest';
import { jobFile } from './job-file';

describe('jobFile', () => {
  it('takes a PDF or a photo of the work order, as base64', () => {
    expect(jobFile({ type: 'application/pdf', data: 'JVBERi0xLjQK' })).toEqual({ kind: 'pdf', data: 'JVBERi0xLjQK' });
    expect(jobFile({ type: 'image/png', data: 'iVBORw0KGgo=' })).toEqual({ kind: 'image', media: 'image/png', data: 'iVBORw0KGgo=' });
  });
  it('turns away anything else', () => {
    expect(jobFile({ type: 'text/html', data: 'PGh0bWw+' })).toBeNull();
    expect(jobFile({ type: 'application/pdf', data: 'data:application/pdf;base64,JVBE' })).toBeNull();
    expect(jobFile({ type: 'application/pdf', data: 'A'.repeat(5_000_000) })).toBeNull();
    expect(jobFile(null)).toBeNull();
  });
});
