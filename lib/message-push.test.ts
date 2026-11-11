import { describe, expect, it } from 'vitest';
import { directMessagePush, messagePush, ownerDirectMessagePush } from './tech-push';

describe('Office message pop-up', () => {
  it('names the job, shows the message and opens the job in the tech app', () => {
    const p = messagePush({ woId: 'abc', woNumber: '19101', content: 'Gate code\n is 4421' });
    expect(p).toEqual({ title: 'Message from FAJ · WO 19101', body: 'Gate code is 4421', url: '/tech?wo=abc', tag: 'msg-abc' });
  });
  it('shortens a long message', () => {
    const p = messagePush({ woId: 'a', woNumber: '1', content: 'x'.repeat(300) });
    expect(p.body.length).toBe(138);
    expect(p.body.endsWith('…')).toBe(true);
  });

  it('opens a private office message in Messenger', () => {
    expect(directMessagePush('Can you call me?')).toEqual({
      title: 'Message from FAJ Solutions',
      body: 'Can you call me?',
      url: '/tech?tab=chat&office=1',
      tag: 'msg-faj-office',
    });
  });

  it("alerts the office when a technician replies", () => {
    expect(ownerDirectMessagePush('Paul Gibbs', 'I am on my way.')).toEqual({
      title: 'Paul Gibbs sent you a message',
      body: 'I am on my way.',
      url: '/admin?view=messages',
      tag: 'msg-tech-paul-gibbs',
    });
  });
});
