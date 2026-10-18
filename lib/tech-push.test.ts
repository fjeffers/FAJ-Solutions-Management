import { describe, expect, it } from 'vitest';
import { newWorkOrderPush, declinedPush } from './tech-push';

describe('new work order pop-up', () => {
  const msg = newWorkOrderPush({
    woId: 'aa-11', woNumber: '19101399', title: 'NetView LDS-1110 — Gaffney SC site 5011876',
    site: '701 West Buford Street, Gaffney, SC', schedule: 'Oct 19, 2026, 8:00 AM – Oct 24, 2026',
  });

  it('says which job, where and when', () => {
    expect(msg.title).toBe('New work order WO 19101399');
    expect(msg.body).toContain('Gaffney, SC');
    expect(msg.body).toContain('8:00 AM');
  });

  it('opens that job in the tech app', () => {
    expect(msg.url).toBe('/tech?wo=aa-11');
    expect(msg.tag).toBe('wo-aa-11');
  });

  it('never carries money', () => {
    expect(JSON.stringify(msg)).not.toMatch(/\$|pay|price|total/i);
  });

  it('still says something when the job has few details', () => {
    expect(newWorkOrderPush({ woId: 'b', woNumber: '5' }).body).toBe('Tap to open it.');
  });
});

describe('declined pop-up for the office', () => {
  it('names the tech and the job, and opens the office', () => {
    const m = declinedPush({ woId: 'g', woNumber: '19101399', techName: 'Frederick Jeffers', title: 'NetView LDS-1110 — Gaffney SC' });
    expect(m.title).toBe('Frederick Jeffers declined WO 19101399');
    expect(m.body).toBe('NetView LDS-1110 — Gaffney SC\nIt needs a tech again.');
    expect(m.url).toBe('/admin');
  });
});
