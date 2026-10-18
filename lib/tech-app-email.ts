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
  const steps = p.hasLogin
    ? `<p style="margin:4px 0;"><strong>Sign in</strong> with your username (or <strong>${email}</strong>) and your password. Forgot it? Tap "Forgot password?" on the sign-in page.</p>`
    : `<p style="margin:4px 0;"><strong>1. Create your login.</strong> On the sign-in page tap <em>"First time? Create your login"</em>. Use your name,
        this email address — <strong>${email}</strong> — then pick a username and a password.</p>
       <p style="margin:12px 0 4px;"><strong>2. Confirm your email</strong> if we send you a confirmation link, then sign in.</p>`;
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
          <p style="margin:12px 0 4px;"><strong>${p.hasLogin ? 'Tip' : '3'}. Put it on your home screen</strong> so it opens like an app:
          iPhone — tap Share, then <em>Add to Home Screen</em>. Android — tap the ⋮ menu, then <em>Install app</em>.</p>
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
