// The email that gives a tech the tech app (Fred, 2026-10-06: "also you
// remove how to send the app to tech"). It points at app.fajsolutions.com/tech
// only and says nothing about the office — techs never see it (same day:
// "the tech should not see the admin login or anything about admin").
// The steps match the tech sign-in page: first time, "Create your login" with
// name, the email on file, a username and a password.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function techAppEmail(p: { name: string; email: string; appUrl: string; hasLogin: boolean }): { subject: string; html: string } {
  const first = esc(p.name.trim().split(/\s+/)[0] || 'there');
  const url = esc(p.appUrl);
  const email = esc(p.email);
  const subject = 'Your FAJ Solutions tech app';
  // The steps for iPhone and Android, and the mail-app trap: a link tapped inside
  // Yahoo Mail or Gmail opens in that app's own browser, which can't install
  // anything (Fred, 2026-10-19: "push the app installation on all tech for
  // iphone and android").
  const open = `<p style="margin:4px 0;"><strong>1. Open it in Safari (iPhone) or Chrome (Android)</strong>, not inside your email app.
        If the button opens inside your email app, tap ⋯ or ⋮ and choose <em>Open in Safari</em> or <em>Open in Chrome</em>,
        or type <strong>${esc(p.appUrl.replace(/^https?:\/\//, ''))}</strong> into Safari or Chrome yourself.</p>`;
  const steps = p.hasLogin
    ? `${open}
       <p style="margin:12px 0 4px;"><strong>2. Sign in</strong> with your username (or <strong>${email}</strong>) and your password. Forgot it? Tap "Forgot password?" on the sign-in page.</p>`
    : `${open}
       <p style="margin:12px 0 4px;"><strong>2. Create your login.</strong> Tap <em>"First time? Create your login"</em>. Use your name,
        this email address (<strong>${email}</strong>), then pick a username and a password. Tap the link in the confirmation email we send you.</p>`;
  const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="color:#0E1B2E;">Hi ${first},</h2>
        <p>Here's the FAJ Solutions tech app: your jobs, your schedule, messages with us, your pay history and your paperwork,
        all in one place on your phone.</p>
        <p style="margin:24px 0;">
          <a href="${url}" style="background:#0E1B2E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Open the tech app</a>
        </p>
        <div style="background:#f6f4ef;padding:16px;border-radius:8px;margin:16px 0;">
          ${steps}
          <p style="margin:12px 0 4px;"><strong>3. Put it on your home screen</strong> so it opens like an app:</p>
          <p style="margin:4px 0 4px 12px;"><strong>iPhone (Safari):</strong> tap Share (the square with the arrow), then <em>Add to Home Screen</em>, then <em>Add</em>.</p>
          <p style="margin:4px 0 4px 12px;"><strong>Android (Chrome):</strong> tap ⋮ (top right), then <em>Install app</em> or <em>Add to Home screen</em>.</p>
          <p style="margin:12px 0 4px;"><strong>4. Open FAJ Tech from your home screen</strong> and sign in. In Profile, tap <em>Turn on pop-ups</em> so new jobs reach your phone.</p>
        </div>
        <p>Your login only ever shows your own jobs and your own pay. Anything unclear, just reply to this email.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions · Bringing People and Technology Together</p>
      </div>
    `;
  return { subject, html };
}

/** The "get the app" part of a tech's first new-job email (Fred, 2026-10-18:
 *  "the first time they get the portal in an email and they download the app,
 *  then when I have new jobs they get a notification on their phone"). */
export function techAppInviteBlock(appUrl: string): string {
  const url = esc(appUrl);
  return `
        <div style="background:#f6f4ef;padding:16px;border-radius:8px;margin:20px 0;">
          <p style="margin:0 0 8px;font-weight:700;color:#0E1B2E;">Get the FAJ Solutions tech app</p>
          <p style="margin:4px 0;"><strong>1.</strong> On your phone, open <a href="${url}" style="color:#0E1B2E;font-weight:600;">${esc(appUrl.replace(/^https?:\/\//, ''))}</a>
            and tap <em>"First time? Create your login"</em>.</p>
          <p style="margin:4px 0;"><strong>2.</strong> Put it on your home screen: iPhone — tap Share, then <em>Add to Home Screen</em>. Android — tap the ⋮ menu, then <em>Install app</em>.</p>
          <p style="margin:4px 0;"><strong>3.</strong> Open it from your home screen, go to Profile and tap <em>Turn on pop-ups</em>.</p>
          <p style="margin:10px 0 0;">After that, new jobs come straight to your phone.</p>
        </div>`;
}

/**
 * "Confirm your FAJ tech login": the link that confirms a new tech login and
 * signs the tech straight in (app/api/tech/signup, app/api/tech/confirm). Sent
 * from FAJ's own email so it arrives (Fred, 2026-10-19).
 */
export function confirmLoginEmail(p: { name: string; link: string; username: string }): { subject: string; html: string } {
  const first = esc(p.name.trim().split(/\s+/)[0] || 'there');
  const link = esc(p.link);
  return {
    subject: 'Confirm your FAJ tech login',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1B1C1F;line-height:1.55;">
  <div style="background:#0E1B2E;color:#fff;padding:18px 20px;border-radius:12px 12px 0 0;">
    <div style="color:#C9A24B;font-size:11px;font-weight:700;letter-spacing:3px;">FAJ SOLUTIONS</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px;">Confirm your tech login</div>
  </div>
  <div style="border:1px solid #E4DFD3;border-top:none;border-radius:0 0 12px 12px;padding:20px;">
    <p style="margin:0 0 12px;">Hi ${first},</p>
    <p style="margin:0 0 16px;">Tap the button to confirm your email. It signs you in to the FAJ tech app and opens your jobs.</p>
    <p style="text-align:center;margin:0 0 18px;">
      <a href="${link}" style="display:inline-block;background:#C9A24B;color:#0E1B2E;font-weight:700;text-decoration:none;padding:13px 26px;border-radius:10px;">Confirm and open my jobs</a>
    </p>
    <p style="margin:0 0 6px;font-size:13px;color:#5E6470;">After this, sign in at app.fajsolutions.com/tech with your username <strong>${esc(p.username)}</strong> (or this email) and your password.</p>
    <p style="margin:0;font-size:12px;color:#8A8F98;">Didn't ask for this? You can ignore this email.</p>
  </div>
</div>`,
  };
}
