import { describe, it, expect } from 'vitest';
import { extractWorkOrderFields, extractDate, extractTime } from './wo-extract';

const NOW = new Date('2026-07-10T12:00:00');

describe('extractWorkOrderFields', () => {
  it('captures a fixed price, address, date, time, and phone from a dispatch blurb', () => {
    const f = extractWorkOrderFields(
      'Install a new security camera at 4821 Main St, Springfield, IL 62704 on 7/15 at 9am. ' +
      'Job pays $450. On-site contact Mike (217) 555-0142, mike@acme.com.',
      NOW,
    );
    expect(f.pay_type).toBe('Fixed');
    expect(f.total_amount).toBe(450);
    expect(f.site_address).toBe('4821 Main St');
    expect(f.site_city).toBe('Springfield');
    expect(f.site_state).toBe('IL');
    expect(f.site_zip).toBe('62704');
    expect(f.start_date).toBe('2026-07-15');
    expect(f.start_time).toBe('09:00');
    expect(f.poc_phone).toBe('(217) 555-0142');
    expect(f.poc_email).toBe('mike@acme.com');
    expect(f.title).toBeTruthy();
    expect(f.description).toContain('security camera');
  });

  it('detects hourly pay', () => {
    const f = extractWorkOrderFields('Cable cleanup, pays $65/hr, roughly 6 hours.', NOW);
    expect(f.pay_type).toBe('Hourly');
    expect(f.hourly_rate).toBe(65);
  });

  it('detects per-device pay with a device count', () => {
    const f = extractWorkOrderFields('Swap 12 devices at $35 per device.', NOW);
    expect(f.pay_type).toBe('Per Device');
    expect(f.per_device_rate).toBe(35);
    expect(f.device_count).toBe(12);
  });

  it('picks the amount near pay keywords over other dollar figures', () => {
    const f = extractWorkOrderFields('Client was quoted $2,000 total. Tech pays $350.', NOW);
    expect(f.total_amount).toBe(350);
  });

  it('handles thousands separators', () => {
    const f = extractWorkOrderFields('Full buildout, price $1,250.50.', NOW);
    expect(f.total_amount).toBe(1250.5);
  });

  it('returns empty for empty input', () => {
    expect(extractWorkOrderFields('', NOW)).toEqual({});
  });
});

describe('extractDate', () => {
  it('parses ISO, US numeric, and month-name dates', () => {
    expect(extractDate('due 2026-08-01', NOW)).toBe('2026-08-01');
    expect(extractDate('on 8/1/26', NOW)).toBe('2026-08-01');
    expect(extractDate('on 8/1', NOW)).toBe('2026-08-01');
    expect(extractDate('scheduled for August 1st', NOW)).toBe('2026-08-01');
    expect(extractDate('no date here', NOW)).toBeNull();
  });
});

describe('extractTime', () => {
  it('parses am/pm times to 24-hour', () => {
    expect(extractTime('at 9am')).toBe('09:00');
    expect(extractTime('at 2:30 pm')).toBe('14:30');
    expect(extractTime('12pm sharp')).toBe('12:00');
    expect(extractTime('no time')).toBeNull();
  });
});
