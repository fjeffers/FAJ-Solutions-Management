// The Google script that hands Fred's job emails to the app (migration 134;
// Fred, 2026-10-18: "Small Google script"). Fred pastes it into
// script.google.com in his own Google account, runs "start" once and presses
// Allow. Every 10 minutes it asks the app which emails to look for, sends new
// ones to /api/inbox, and labels each thread it sent "FAJ app" so it goes once.
// It only reads mail. Pure, so it is unit-tested (lib/inbox-script.test.ts).

export const INBOX_LABEL = 'FAJ app';

/** The whole script, with the app's address and Fred's private key filled in. */
export function inboxScript(appUrl: string, key: string): string {
  const app = `${appUrl.replace(/\/+$/, '')}/api/inbox`;
  return `// FAJ Solutions: job emails to the FAJ app.
// Run "start" once and press Allow. After that it works by itself every
// 10 minutes. It only reads your mail, and marks each email it has handed to
// the app with the label "${INBOX_LABEL}". Which emails it looks for is set in
// the FAJ app, under Work orders > Job emails.
var APP = '${app}';
var KEY = '${key}';
var LABEL = '${INBOX_LABEL}';

function start() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkInbox').timeBased().everyMinutes(10).create();
  checkInbox();
}

function checkInbox() {
  var s = UrlFetchApp.fetch(APP + '?key=' + KEY, { muteHttpExceptions: true });
  if (s.getResponseCode() !== 200) return;
  var query = JSON.parse(s.getContentText()).query;
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL);
  var threads = GmailApp.search('(' + query + ') newer_than:14d -label:"' + LABEL + '"', 0, 20);
  threads.forEach(function (t) {
    var emails = t.getMessages().slice(-10).map(function (m) {
      return { id: m.getId(), from: m.getFrom(), subject: m.getSubject(), at: m.getDate().toISOString(), body: m.getPlainBody().slice(0, 30000) };
    });
    var r = UrlFetchApp.fetch(APP, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ key: KEY, emails: emails })
    });
    if (r.getResponseCode() === 200) t.addLabel(label);
  });
}
`;
}

/** What goes into Generate with AI for one job email. */
export function emailForAi(e: { from_addr: string | null; subject: string | null; received_at: string | null; body: string | null }): string {
  return [
    e.from_addr ? `From: ${e.from_addr}` : '',
    e.received_at ? `Date: ${new Date(e.received_at).toLocaleString('en-US', { timeZone: 'America/New_York' })}` : '',
    e.subject ? `Subject: ${e.subject}` : '',
    '',
    (e.body ?? '').trim(),
  ].filter((l, i) => l || i === 3).join('\n').trim();
}
