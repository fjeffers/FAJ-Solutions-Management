import { describe, expect, it } from 'vitest';
import { oneInbox, unreadFromField, type InboxImport, type InboxTicket } from './one-inbox';
import type { InboxMessage } from './messages-inbox';

const msg = (o: Partial<InboxMessage>): InboxMessage => ({
  id: 'm1', work_order_id: '191', sender_name: 'Paul Gibbs', sender_role: 'contractor', content: 'On site', read_at: null,
  created_at: '2026-11-08T12:00:00Z', ...o,
});
const ticket = (o: Partial<InboxTicket> = {}): InboxTicket => ({
  id: 't1', from_name: 'TeamNetView', from_email: 'd@teamnetview.com', subject: 'WO 300', summary: 'New install Friday',
  received_at: '2026-11-08T11:00:00Z', urgent: false, ...o,
});
const imp = (o: Partial<InboxImport> = {}): InboxImport => ({
  id: 'i1', status: 'pending', created_at: '2026-11-08T10:00:00Z', parsed_fields: { title: 'Refresh', customer_name: 'Acme' }, ...o,
});
const jobs = new Map([['191', 'w1']]);

describe('oneInbox', () => {
  it('puts tech and client messages, emails and imports in one list, newest first', () => {
    const items = oneInbox({ messages: [msg({}), msg({ id: 'm2', sender_role: 'client', sender_name: 'Dana', created_at: '2026-11-08T09:00:00Z' })],
      tickets: [ticket()], imports: [imp()], jobs });
    expect(items.map((i) => i.kind)).toEqual(['tech', 'email', 'import', 'client']);
    expect(items[0]).toMatchObject({ who: 'Paul Gibbs · WO 191', text: 'On site', woId: 'w1' });
    expect(items[1]).toMatchObject({ who: 'TeamNetView', text: 'New install Friday', view: 'support' });
    expect(items[2]).toMatchObject({ who: 'Acme', text: 'Refresh', view: 'import-queue' });
  });

  it('skips read messages, the office\'s own, and imports already handled', () => {
    expect(oneInbox({ messages: [msg({ read_at: '2026-11-08T12:01:00Z' }), msg({ sender_role: 'admin' })], tickets: [],
      imports: [imp({ status: 'approved' })], jobs })).toEqual([]);
  });

  it('keeps one row per job and sender, the latest', () => {
    const items = oneInbox({ messages: [msg({}), msg({ id: 'm2', content: 'Done', created_at: '2026-11-08T13:00:00Z' })], tickets: [], imports: [], jobs });
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe('Done');
  });

  it('puts urgent emails first', () => {
    const items = oneInbox({ messages: [msg({})], tickets: [ticket({ urgent: true, received_at: '2026-11-01T00:00:00Z' })], imports: [], jobs });
    expect(items[0].kind).toBe('email');
  });

  it('counts a client message as unread for the office', () => {
    expect(unreadFromField({ sender_role: 'client', read_at: null })).toBe(true);
    expect(unreadFromField({ sender_role: 'admin', read_at: null })).toBe(false);
  });
});
