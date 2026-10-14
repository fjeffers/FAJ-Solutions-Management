// Live alerts on projects (Fred, 2026-10-13: "get a notification ASAP ...
// pictures uploaded I receive it, or the PM"). Migration 119 fills the outbox
// (project_alerts) from the techs' taps; /api/alerts/dispatch sends each one
// to the project's list — phone pop-up, email, text. This file is the words
// and the list. Pure and unit-tested (lib/project-alerts.test.ts). No tech pay
// anywhere: a receipt's amount is the tech's own receipt, nothing else.

export type AlertKind =
  | 'day_start' | 'travel_start' | 'travel_end' | 'sign_out' | 'start_job' | 'off_site'
  | 'site_finished' | 'photos' | 'receipt' | 'notes' | 'answers' | 'test'
  // Messages on the live sheet (migration 121).
  | 'message' | 'issue' | 'resolved' | 'answer' | 'client_message'
  // End of day, stepped off site, running late (migration 122).
  | 'report' | 'away' | 'late';

export type AlertRow = {
  id: string; user_id: string; wo_id: string | null; wo_number: string; project_name: string;
  kind: AlertKind; tech: string | null; at: string; detail: Record<string, unknown>;
};

export type AlertJob = { title: string; site: string; city: string; state: string };

export type AlertPerson = {
  name: string; role: 'owner' | 'assistant' | 'pm' | 'other';
  email: string | null; phone: string | null; auth_user_id: string | null;
  by_email: boolean; by_push: boolean; by_text: boolean;
};

/** Fred's inbox — the same one the app's other owner emails go to. */
export const OWNER_ALERT_EMAIL = 'fajsolutions@gmail.com';

export const ROLE_LABEL: Record<AlertPerson['role'], string> = {
  owner: 'You', assistant: 'Assistant', pm: 'Project manager', other: 'Other',
};

const DEST_WORD: Record<string, string> = { site: 'the site', hotel: 'the hotel', home: 'home', next_site: 'the next site' };
const CATEGORY: Record<string, string> = {
  materials: 'parts & materials', fuel: 'fuel', tolls_parking: 'tolls & parking', equipment: 'equipment', meals: 'meal', hotel: 'hotel', other: 'other',
};

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const money = (n: unknown): string => {
  const v = Number(n);
  return Number.isFinite(v) ? `$${v.toFixed(2)}` : '';
};

export type AlertMessage = {
  /** One line: the pop-up title and the email subject's end. */
  title: string;
  /** Where and when: "TEST Rockingham · WO TEST-PRJ-1 · 6:45 AM". */
  where: string;
  /** Extra lines (miles, reasons, the notes, the answers, the receipt). */
  lines: string[];
  /** Photo links (photos alert). */
  photos: string[];
};

export function alertMessage(a: AlertRow, job: AlertJob | null, timeZone = 'America/New_York'): AlertMessage {
  const who = str(a.tech) || 'A tech';
  const d = a.detail ?? {};
  const time = new Date(a.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const place = job ? (job.site || job.title || 'Site') : 'Site';
  const town = job ? [job.city, job.state].filter(Boolean).join(', ') : '';
  const where = [town ? `${place} (${town})` : place, `WO ${a.wo_number}`, time].join(' · ');
  const lines: string[] = [];
  const miles = d.miles == null || d.miles === '' ? null : Number(d.miles);
  const dest = DEST_WORD[str(d.dest)] ?? 'the site';
  let title: string;
  switch (a.kind) {
    case 'day_start': title = `${who} clocked in`; break;
    case 'travel_start': title = `${who} is driving to ${dest}`; break;
    case 'travel_end':
      title = `${who} arrived at ${dest}`;
      if (miles != null && Number.isFinite(miles)) lines.push(`About ${miles} miles`);
      break;
    case 'sign_out':
      title = `${who} signed out (arrived at ${dest})`;
      if (miles != null && Number.isFinite(miles)) lines.push(`Last drive: about ${miles} miles`);
      break;
    case 'start_job': title = `${who} started the job`; break;
    case 'off_site': title = `${who} left the site (coming back)`; break;
    case 'site_finished': {
      title = `${who} finished the site`;
      const signedBy = str(d.signed_by);
      const skip = d.sign_skip && typeof d.sign_skip === 'object' ? str((d.sign_skip as Record<string, unknown>).reason) : '';
      if (signedBy) lines.push(`Signed off by ${signedBy}`);
      else if (skip) lines.push(`No signature: ${skip}`);
      const skipped = d.skipped && typeof d.skipped === 'object' ? Object.entries(d.skipped as Record<string, unknown>) : [];
      for (const [item, why] of skipped) lines.push(`Couldn't do "${item}": ${str(why)}`);
      break;
    }
    case 'photos': {
      const n = Math.max(1, Number(d.count) || 1);
      title = `${n} new ${n === 1 ? 'photo' : 'photos'} from ${who}`;
      break;
    }
    case 'receipt': {
      const cat = CATEGORY[str(d.category)] ?? 'other';
      title = `${who} added a ${cat} receipt: ${money(d.amount)}`;
      if (str(d.vendor)) lines.push(str(d.vendor));
      break;
    }
    case 'notes':
      title = `${who} updated the job notes`;
      if (str(d.notes)) lines.push(str(d.notes).slice(0, 600));
      break;
    case 'answers': {
      title = `${who} answered the job's questions`;
      const answers = Array.isArray(d.answers) ? d.answers as Record<string, unknown>[] : [];
      for (const q of answers.slice(0, 12)) lines.push(`${str(q.q)}: ${str(q.a)}`);
      break;
    }
    case 'test': title = 'Test alert: project alerts are working'; break;
    // Messages on the live sheet (migration 121).
    case 'message': {
      const to = str(d.to);
      title = `${who} sent a message${to ? ` to ${to}` : ''}`;
      if (str(d.body)) lines.push(str(d.body));
      break;
    }
    case 'issue': {
      const body = str(d.body) || 'No access to the building';
      const access = body.startsWith('No access');
      title = `${who}: ${body}`;
      if (str(d.reason)) lines.push(access ? `Why: ${str(d.reason)}` : str(d.reason));
      lines.push(access ? 'Waiting without access until they say they are in. Reply on the live sheet.'
        : "Stopped until they're back to work. Reply on the live sheet.");
      break;
    }
    case 'resolved': {
      const m = Number(d.waited_min);
      const access = !str(d.body) || str(d.body) === 'Got access';
      title = access ? `${who} has access now` : `${who} is back to work`;
      if (Number.isFinite(m)) lines.push(`Waited ${m} min ${access ? 'without access' : 'stopped'}`);
      break;
    }
    case 'answer':
      title = `${who} answered${str(d.to) ? ` ${str(d.to)}` : ''}`;
      if (str(d.body)) lines.push(str(d.body));
      break;
    case 'report':
      title = `${who}'s end-of-day report`;
      if (str(d.body)) lines.push(...str(d.body).split('\n').map((l) => l.trim()).filter(Boolean));
      break;
    case 'away':
      title = `${who} stepped off site: ${str(d.reason) || 'other'}`;
      if (str(d.body) && str(d.body) !== 'Stepped off site') lines.push(str(d.body));
      break;
    case 'late':
      if (str(d.reason)) {
        title = `${who} is running late: ${str(d.reason)}`;
        if (str(d.body)) lines.push(str(d.body));
      } else {
        title = `${who} is not on site yet`;
        lines.push(`30 minutes past the ${str(d.start) || 'scheduled'} start. They've been asked why.`);
      }
      break;
    case 'client_message': {
      const what = str(d.kind) === 'question' ? 'asked a question' : str(d.kind) === 'note' ? 'added a note' : 'sent a message';
      title = `${who} ${what} on the live sheet${str(d.to) ? ` (to ${str(d.to)})` : ''}`;
      if (str(d.body)) lines.push(str(d.body));
      break;
    }
    default: title = `${who}: update on the job`;
  }
  const photos = a.kind === 'photos' && Array.isArray(d.urls) ? (d.urls as unknown[]).map(str).filter((u) => /^https:\/\//.test(u)) : [];
  return { title, where, lines, photos };
}

/** Who gets it: the project's list, or the owner alone while the list is empty. */
export function recipientsFor(people: AlertPerson[], ownerId: string): AlertPerson[] {
  if (people.length > 0) return people;
  return [{
    name: 'You', role: 'owner', email: OWNER_ALERT_EMAIL, phone: null, auth_user_id: ownerId,
    by_email: true, by_push: true, by_text: false,
  }];
}

/**
 * Who gets this alert. A message from the sheet goes to the office logins only
 * (the PM wrote it). A tech's message to one person goes to that person and
 * the office; to everyone, to the whole list.
 */
export function recipientsForAlert(people: AlertPerson[], ownerId: string, a: Pick<AlertRow, 'kind' | 'detail'>): AlertPerson[] {
  const all = recipientsFor(people, ownerId);
  const office = all.filter((p) => p.role === 'owner' || p.role === 'assistant');
  if (a.kind === 'client_message') {
    return office.length > 0 ? office : recipientsFor([], ownerId);
  }
  const to = str(a.detail?.to).toLowerCase();
  if (to && ['message', 'issue', 'resolved', 'answer'].includes(a.kind)) {
    const named = all.filter((p) => p.name.trim().toLowerCase() === to);
    if (named.length > 0) return [...new Map([...named, ...office].map((p) => [`${p.name}|${p.email}|${p.auth_user_id}`, p])).values()];
  }
  return all;
}

/** Only the office's own logins get a link into the app; a client's PM does not. */
export const canOpenApp = (p: AlertPerson): boolean => p.role === 'owner' || p.role === 'assistant';

/** "(484) 867-7191", "484.867.7191", "+1 484 867 7191" → "+14848677191"; anything else → null. */
export function toE164(phone: string | null | undefined): string | null {
  const digits = str(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The email: plain, the FAJ colors, photos as thumbnails. */
export function alertEmailHtml(project: string, m: AlertMessage, link: string | null): string {
  const lines = m.lines.map((l) => `<p style="margin:4px 0;white-space:pre-wrap">${esc(l)}</p>`).join('');
  const photos = m.photos.length
    ? `<div style="margin-top:10px">${m.photos.map((u) => `<a href="${esc(u)}"><img src="${esc(u)}" alt="Photo" width="150" style="width:150px;height:110px;object-fit:cover;border-radius:6px;margin:0 6px 6px 0;border:1px solid #E4DFD3"></a>`).join('')}</div>`
    : '';
  const button = link
    ? `<p style="margin-top:16px"><a href="${esc(link)}" style="background:#0E1B2E;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open the job</a></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1B1C1F">
  <div style="font-size:12px;letter-spacing:1px;color:#B8912F;font-weight:700;text-transform:uppercase">${esc(project)}</div>
  <h2 style="margin:6px 0 4px;color:#0E1B2E">${esc(m.title)}</h2>
  <div style="color:#5E6470;font-size:13px">${esc(m.where)}</div>
  ${lines}${photos}${button}
  <p style="margin-top:20px;font-size:11px;color:#9AA0AA">FAJ Solutions project alert.</p>
</div>`;
}
