import { describe, expect, it } from 'vitest';
import { parseSimplySubPackage, SIMPLYSUB_BOOKMARKLET } from './simplysub';

describe('parseSimplySubPackage', () => {
  const pkg = {
    job: { id: '3123', title: 'LDS - 5006902 - WILMINGTON NC', jobNumber: '26', customer: 'LDS - Compucom', scheduledStart: '11/09/2026', address: '514 South College Road, WILMINGTON, NC 28412' },
    tasks: [
      { title: 'LDS - Day 1', items: ['Pre-Existing Damage Photos', 'Building Walkthrough'] },
      { title: 'LDS - HVAC Cable Pull', items: ['Cable Pulled', 'Cable Tested'] },
      { title: 'AP-01 Install', items: ['Cabled Pulled', 'Parch cable left plugged in'] },
    ],
    files: [{ name: 'Heat Map', url: 'https://cdn.simplysub.com/84/uploads/a/heat.pdf' }, { name: 'bad', url: 'https://evil.example/x' }],
  };

  it('builds a simplified reviewed work order draft', () => {
    const f = parseSimplySubPackage(pkg, 'https://drive.google.com/drive/folders/149vdTeZDgIBVVelC49W8WgcorQY7Gr_o');
    expect(f).toMatchObject({ external_wo_id: '3123', client_reference: '26', customer_name: 'LDS - Compucom', start_date: '2026-11-09', city: 'WILMINGTON', state: 'NC', zip: '28412' });
    expect(f.wo_tasks?.map((t) => t.label)).toEqual([
      'Day 1 · Pre-Existing Damage Photos', 'Day 1 · Building Walkthrough',
      'All runs · Cable Pulled', 'All runs · Cable Tested', 'All runs · Patch cable left plugged in',
    ]);
    expect(f.custom_qa?.find((q) => q.id === 'simplysub-q-runs')?.label).toContain('HVAC Cable Pull, AP-01 Install');
    expect(f.custom_qa?.some((q) => q.type === 'photo')).toBe(true);
    expect(f.source_documents).toEqual([{ name: 'Heat Map', url: 'https://cdn.simplysub.com/84/uploads/a/heat.pdf', category: undefined }]);
    expect(f.client_links).toContain('https://drive.google.com/drive/folders/149vdTeZDgIBVVelC49W8WgcorQY7Gr_o');
  });

  it('rejects files that are not SimplySub jobs', () => {
    expect(() => parseSimplySubPackage({ job: {} })).toThrow('SimplySub job');
  });

  it('ships a bookmarklet that reads the job pages', () => {
    expect(SIMPLYSUB_BOOKMARKLET.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(SIMPLYSUB_BOOKMARKLET.slice(11))).toContain("'overview', 'tasks', 'files', 'forms'");
  });
});
