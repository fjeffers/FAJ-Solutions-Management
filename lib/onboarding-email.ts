// The paperwork email a tech gets from "Request W-9" (Fred, 2026-10-06: the
// old one said "Welcome aboard … before your first job" to techs with months
// of jobs, and asked for both forms even when one was already done).
// It asks only for what's still missing, and reads right for a new tech and a
// long-time one alike.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function onboardingEmail(p: {
  name: string;
  portalUrl: string;
  /** Defaults to true: ask for it. */
  needsW9?: boolean;
  needsAgreement?: boolean;
}): { subject: string; html: string } {
  const needsW9 = p.needsW9 !== false;
  const needsAgreement = p.needsAgreement !== false;
  // Nothing missing still sends both, so a "Resend" never arrives blank.
  const both = needsW9 === needsAgreement;
  const items: string[] = [];
  if (needsW9 || both) items.push('<strong>Your W-9.</strong> Fill in the short form on the page, or upload a photo or PDF of a signed one. We use it for your 1099 at year end.');
  if (needsAgreement || both) items.push('<strong>The contractor agreement.</strong> Read it and type your full legal name to sign.');
  const what = items.length === 2 ? 'your W-9 and contractor agreement' : needsW9 || both ? 'your W-9' : 'your contractor agreement';
  const first = esc(p.name.trim().split(/\s+/)[0] || 'there');
  const url = esc(p.portalUrl);

  const subject = `FAJ Solutions — ${what}`;
  const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
        <h2 style="color:#0E1B2E;">Hi ${first},</h2>
        <p>We need ${items.length === 2 ? 'two things' : 'one thing'} on file from you so we can keep paying you
        and send your 1099 at year end. ${items.length === 2 ? 'Both are' : "It's"} on your contractor portal —
        one link, no account to create, and it takes a couple of minutes:</p>
        <p style="margin:24px 0;">
          <a href="${url}" style="background:#0E1B2E;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Open your paperwork</a>
        </p>
        <div style="background:#f6f4ef;padding:16px;border-radius:8px;margin:16px 0;">
          ${items.map((t, i) => `<p style="margin:${i === 0 ? '4px' : '12px'} 0 4px;">${items.length > 1 ? `${i + 1}. ` : ''}${t}</p>`).join('\n          ')}
        </div>
        <p>Your tax details are stored privately and only FAJ Solutions can see them.
        If you've already sent this in, you can ignore this email. Anything unclear, just reply.</p>
        <p style="color:#888;font-size:12px;">— FAJ Solutions · Bringing People and Technology Together</p>
      </div>
    `;
  return { subject, html };
}
