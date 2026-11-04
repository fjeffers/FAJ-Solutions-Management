import { describe, it, expect } from 'vitest';
import { jobFile, jobFiles } from './job-file';

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

describe('jobFiles', () => {
  it('takes two or more files, or one the old way', () => {
    expect(jobFiles([{ type: 'application/pdf', data: 'JVBERi0xLjQK' }, { type: 'image/png', data: 'iVBORw0KGgo=' }])).toHaveLength(2);
    expect(jobFiles({ type: 'application/pdf', data: 'JVBERi0xLjQK' })).toHaveLength(1);
    expect(jobFiles(undefined)).toEqual([]);
  });
  it('turns away a bad file, too many files, or too much in total', () => {
    expect(jobFiles([{ type: 'application/pdf', data: 'JVBERi0xLjQK' }, { type: 'text/html', data: 'PGh0bWw+' }])).toBeNull();
    expect(jobFiles(Array(6).fill({ type: 'image/png', data: 'iVBORw0KGgo=' }))).toBeNull();
    expect(jobFiles([{ type: 'application/pdf', data: 'A'.repeat(2_500_000) }, { type: 'application/pdf', data: 'A'.repeat(2_500_000) }])).toBeNull();
  });
});
