import { describe, it, expect } from 'vitest';
import { emailForAi, inboxScript, INBOX_LABEL } from './inbox-script';

describe('the Google script for job emails (Fred, 2026-10-18)', () => {
  const key = 'a'.repeat(64);
  const s = inboxScript('https://app.fajsolutions.com/', key);

  it('talks to the app with the private key', () => {
    expect(s).toContain("var APP = 'https://app.fajsolutions.com/api/inbox';");
    expect(s).toContain(`var KEY = '${key}';`);
  });

  it('runs every 10 minutes from "start", and sends each email once', () => {
    expect(s).toContain('function start()');
    expect(s).toContain('everyMinutes(10)');
    expect(s).toContain(`var LABEL = '${INBOX_LABEL}';`);
    expect(s).toContain('-label:"');
    expect(s).toContain('t.addLabel(label)');
  });

  it('only reads mail: no sending, deleting or moving', () => {
    for (const w of ['sendEmail', 'moveToTrash', 'deleteMessage', 'createDraft', 'forward', 'reply']) expect(s).not.toContain(w);
  });

  it('hands the AI the email as Fred would paste it', () => {
    expect(emailForAi({ from_addr: 'Mike <m@x.com>', subject: 'WO 1910', received_at: null, body: '  Site 5011876  ' }))
      .toBe('From: Mike <m@x.com>\nSubject: WO 1910\n\nSite 5011876');
  });
});
