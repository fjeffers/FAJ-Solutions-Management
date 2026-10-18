import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendNewJobNotice } from './notify';

const job = {
  id: 'g1', wo_number: '19101399', title: 'NetView LDS-1110 — Gaffney SC site 5011876',
  external_wo_id: '5011876', client_reference: null, source_platform: 'NetView',
  site_name: null, site_address: '123 Main St', site_city: 'Gaffney', site_state: 'SC',
  start_date: '2026-10-19', start_time: '08:00', end_date: '2026-10-24', end_time: null,
  total_amount: 4200,
};
const tech = { name: 'Frederick Jeffers', email: 'tech@example.com', portal_token: 'tok' };

describe('new-job notice for a job that already exists', () => {
  afterEach(() => vi.unstubAllGlobals());

  const sent = async (pay?: number | null) => {
    const f = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', f);
    await sendNewJobNotice(job, tech, pay);
    return JSON.parse(String((f.mock.calls[0][1] as { body: string }).body));
  };

  it('goes as a new assignment, with the job, when and where', async () => {
    const b = await sent();
    expect(b).toMatchObject({ type: 'wo_assigned', wo_id: 'g1', wo_number: '19101399', contractor_name: 'Frederick Jeffers', portal_token: 'tok' });
    expect(b.schedule).toBe('Oct 19, 2026, 8:00 AM – Oct 24, 2026');
    expect(b.reference).toBe('NetView #5011876');
  });

  it('never carries the client price', async () => {
    const b = await sent(null);
    expect(b.pay).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain('4200');
  });

  it("shows the tech's own pay only when it is set", async () => {
    expect((await sent(350)).pay).toBe(350);
    expect((await sent(0)).pay).toBeUndefined();
  });
});
