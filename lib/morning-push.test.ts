import { describe, expect, it } from 'vitest';
import { morningPush, onToday, type MorningCounts } from './morning-push';

const none: MorningCounts = { jobsToday: 0, noTech: 0, unread: 0, emails: 0, imports: 0, invoicesToSend: 0, overdueTotal: 0, owedTotal: 0 };

describe('morningPush', () => {
  it('says nothing on a quiet morning', () => expect(morningPush(none)).toBeNull());

  it('puts the day in one line each', () => {
    const p = morningPush({ jobsToday: 3, noTech: 1, unread: 2, emails: 1, imports: 0, invoicesToSend: 1, overdueTotal: 1200, owedTotal: 550 });
    expect(p?.body).toBe('3 jobs today (1 with no tech)\nInbox: 2 messages, 1 email\n1 invoice to send\n$1,200.00 overdue from clients\n$550.00 owed to techs');
    expect(p?.url).toBe('/admin');
  });

  it('counts a job on every day from its start to its end', () => {
    expect(onToday({ start_date: '2026-11-07', end_date: '2026-11-09' }, '2026-11-08')).toBe(true);
    expect(onToday({ start_date: '2026-11-08', end_date: null }, '2026-11-08')).toBe(true);
    expect(onToday({ start_date: '2026-11-07', end_date: null }, '2026-11-08')).toBe(false);
    expect(onToday({ start_date: null, end_date: null }, '2026-11-08')).toBe(false);
  });
});
