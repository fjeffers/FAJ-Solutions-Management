import type { CustomQAItem, ParsedNetviewFields, WoTask } from './types';

export type SimplySubPackage = {
  version?: number;
  source?: string;
  job?: {
    id?: string;
    url?: string;
    title?: string;
    jobNumber?: string;
    customer?: string;
    scheduledStart?: string;
    scheduledEnd?: string;
    address?: string;
  };
  tasks?: { title?: string; items?: string[] }[];
  files?: { name?: string; url?: string; category?: string }[];
  forms?: { title?: string; url?: string }[];
};

const clean = (v: unknown, max = 240): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const dayNumber = (label: string): number | null => {
  const m = label.match(/\bday\s*(\d+)\b/i);
  return m ? Number(m[1]) : null;
};

const id = (prefix: string, n: number) => `${prefix}-${n + 1}`;

export function simplifiedDailyQuestions(): CustomQAItem[] {
  const questions: [string, CustomQAItem['type']][] = [
    ['What work was completed today? *', 'textarea'],
    ['Was the site/building walkthrough completed? *', 'yes_no'],
    ['How many feet of cable were run today?', 'number'],
    ['What materials were received today?', 'textarea'],
    ['What materials are missing or damaged?', 'textarea'],
    ['Were the materials inventoried? *', 'yes_no'],
    ['What issues or blockers came up today?', 'textarea'],
    ['Upload the required work and inventory photos. *', 'photo'],
    ['Upload any plans, test results, or other documents.', 'document'],
  ];
  return questions.map(([label, type], n) => ({ id: id('simplysub-q', n), label, type, answer: null }));
}

const DEFAULT_CHECKLIST = [
  'Complete the site walkthrough and document pre-existing damage',
  'Confirm rack, building systems, CNM snapshot, and run plan',
  'Record materials received, inventoried, missing, or damaged',
  'Cable pulled, terminated, labeled, and tested where applicable',
  'Patch cables and required materials left on site',
  'Upload labeled photos and documents',
  'Complete the daily notes and check out',
];

/** "Cabled Terminated", "Parch cable left plugged in" → one shared checklist label. */
export function normalizeTaskLabel(raw: string): string {
  return clean(raw, 160)
    .replace(/\bcabled\b/gi, 'Cable')
    .replace(/\bparch\b/gi, 'Patch')
    .replace(/\bpugged\b/gi, 'plugged')
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}

const sharedChecklist = (groups: NonNullable<SimplySubPackage['tasks']>): string[] => {
  const text = groups.flatMap((g) => [clean(g.title), ...(g.items ?? []).map((x) => normalizeTaskLabel(x))]).join('\n');
  const labels: string[] = [];
  if (/\bcable(?:d)? pulled\b/i.test(text)) labels.push('Cable pulled where applicable');
  if (/\bcable(?:d)? terminated\b/i.test(text)) labels.push('Cable terminated where applicable');
  if (/\bcable(?:d)? labeled\b/i.test(text)) labels.push('Cable and equipment labels completed');
  if (/\bcable(?:d)? tested\b/i.test(text)) labels.push('Cable testing completed');
  if (/patch cable|firewall/i.test(text)) labels.push('Patch cables installed and plugged into the correct ports');
  if (/\bAP installed\b/i.test(text)) labels.push('Access points installed and labeled');
  if (/serial number|MAC address/i.test(text)) labels.push('Serial numbers and MAC addresses recorded');
  if (/Netspot|floorplan uploaded/i.test(text)) labels.push('NetSpot survey completed and results uploaded');
  if (/DeComm|old firewall|old APs/i.test(text)) labels.push('Decommissioning and site cleanup completed');
  return labels;
};

/** Day-specific items stay intact; repeated per-run steps become a short shared checklist. */
export function simplifiedDailyTasks(groups: SimplySubPackage['tasks']): WoTask[] {
  const labels: string[] = [];
  for (const group of groups ?? []) {
    const title = clean(group.title);
    const day = dayNumber(title);
    if (!day) continue;
    for (const item of group.items ?? []) {
      const label = normalizeTaskLabel(item);
      if (!label) continue;
      labels.push(`Day ${day} · ${label}`);
    }
  }
  for (const label of sharedChecklist(groups ?? [])) labels.push(`Daily work · ${label}`);
  const out = labels.length ? labels : DEFAULT_CHECKLIST.map((label) => `Day 1 · ${label}`);
  return [...new Set(out)].slice(0, 30).map((label, n) => ({
    id: id('simplysub-task', n),
    category: 'On Site',
    label,
    completed: false,
    completed_at: null,
  }));
}

/** The runs and devices SimplySub listed as their own tasks (HVAC, AP-01…). */
export function simplySubRuns(groups: SimplySubPackage['tasks']): string[] {
  return [...new Set((groups ?? []).map((g) => clean(g.title, 120).replace(/^LDS\s*-\s*/i, ''))
    .filter((t) => t && !dayNumber(t)))];
}

function dateOnly(v: unknown): string | null {
  const s = clean(v, 40);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function addressParts(raw: unknown): Pick<ParsedNetviewFields, 'site_address' | 'city' | 'state' | 'zip'> {
  const address = clean(raw, 300);
  const m = address.match(/^(.*?),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/i);
  return m
    ? { site_address: m[1], city: m[2], state: m[3].toUpperCase(), zip: m[4] }
    : { site_address: address || null };
}

export function parseSimplySubPackage(input: unknown, deliverableLink?: string): ParsedNetviewFields {
  if (!input || typeof input !== 'object') throw new Error('That package is not valid JSON.');
  const pkg = input as SimplySubPackage;
  const job = pkg.job ?? {};
  const jobId = clean(job.id, 40);
  const sourceUrl = clean(job.url, 500) || (jobId ? `https://app.simplysub.com/jobs/${jobId}/overview` : '');
  if (!jobId && !sourceUrl.includes('app.simplysub.com/jobs/')) throw new Error('That file does not contain a SimplySub job.');

  const documents = (pkg.files ?? []).map((f) => ({
    name: clean(f.name, 160) || 'SimplySub document',
    url: clean(f.url, 1000),
    category: clean(f.category, 80) || undefined,
  })).filter((f) => /^https:\/\/cdn\.simplysub\.com\//i.test(f.url)).slice(0, 30);
  const formLinks = (pkg.forms ?? []).map((f) => clean(f.url, 1000)).filter((u) => /^https:\/\//i.test(u));
  const drive = clean(deliverableLink, 1000);
  const links = [...new Set([sourceUrl, ...formLinks, drive].filter(Boolean))].slice(0, 10);
  const taskGroups = pkg.tasks ?? [];
  const runs = simplySubRuns(taskGroups);
  const questions = simplifiedDailyQuestions();
  if (runs.length) questions.splice(1, 0, { id: 'simplysub-q-runs', label: `Which runs/devices were worked on today? (${runs.slice(0, 20).join(', ')})`, type: 'textarea', answer: null });

  return {
    title: clean(job.title, 160) || `SimplySub Job ${jobId}`,
    description: runs.length
      ? `Imported from SimplySub and simplified into one daily workflow.\n\nRuns and devices:\n${runs.slice(0, 40).map((x) => `• ${x}`).join('\n')}`
      : 'Imported from SimplySub and simplified into one daily workflow.',
    customer_name: clean(job.customer, 120),
    client_reference: clean(job.jobNumber, 80),
    external_wo_id: jobId,
    start_date: dateOnly(job.scheduledStart),
    site_name: clean(job.title, 160),
    ...addressParts(job.address),
    wo_tasks: simplifiedDailyTasks(taskGroups),
    custom_qa: questions,
    client_links: links,
    deliverable_link: drive || null,
    deliverables: 'Daily questions and notes\nMaterials received and missing\nLabeled photos\nPlans, test results, and documents\nDaily completion and check-out',
    source_documents: documents,
  };
}

/** Runs in the signed-in SimplySub tab; reads the job pages and downloads a package for FAJ. No password or cookie leaves the browser. */
export const SIMPLYSUB_COPY_SCRIPT = '(async () => {\n  const m = location.pathname.match(/\\/jobs\\/(\\d+)/);\n  if (!m) { alert(\'Open a SimplySub job first.\'); return; };\n  const id = m[1];\n  const get = async (p) => new DOMParser().parseFromString(await (await fetch(\'/jobs/\' + id + \'/\' + p, { credentials: \'same-origin\' })).text(), \'text/html\');\n  const pages = await Promise.all([\'overview\', \'tasks\', \'files\', \'forms\'].map(get));\n  const o = pages[0], t = pages[1], f = pages[2], fo = pages[3];\n  const txt = (e) => (e && e.textContent ? e.textContent.replace(/\\s+/g, \' \').trim() : \'\');\n  const link = (q) => txt(o.querySelector(\'a[href*="go_to_property=\' + q + \'"]\'));\n  const card = (x) => { let e = x.parentElement; while (e && !e.querySelector(\'.file-title\')) e = e.parentElement; return e; };\n  const tasks = [...t.querySelectorAll(\'input[aria-label^="Complete "]\')].map((x) => {\n    const title = (x.getAttribute(\'aria-label\') || \'\').replace(/^Complete\\s+/, \'\').trim();\n    const pid = ((x.getAttribute(\'onchange\') || \'\').match(/toggleObjectTask\\(\\d+,\\s*(\\d+)/) || [])[1];\n    const items = pid ? [...t.querySelectorAll(\'.object-subtask-row[data-parent-task-itemid="\' + pid + \'"] .object-subtask-title\')].map(txt).filter(Boolean) : [];\n    return { title, items: [...new Set(items)] };\n  });\n  const files = [...f.querySelectorAll(\'[data-original-url], a[href*="cdn.simplysub.com"]\')].map((x) => {\n    const url = x.getAttribute(\'data-original-url\') || x.href;\n    const c = card(x);\n    const name = txt(c && c.querySelector(\'.file-title\')) || x.getAttribute(\'data-preview-title\') || decodeURIComponent(url.split(\'/\').pop() || \'Document\');\n    const category = txt(c && c.querySelector(\'.file-badges > *\'));\n    return { name, url, category };\n  }).filter((x) => /^https:\\/\\/cdn\\.simplysub\\.com\\//.test(x.url));\n  const forms = [...fo.querySelectorAll(\'a[href*="/forms/"]\')].map((x) => ({ title: txt(x), url: x.href })).filter((x) => x.title && !/my-forms/.test(x.url));\n  const pkg = {\n    version: 1, source: \'SimplySub\',\n    job: {\n      id, url: location.origin + \'/jobs/\' + id + \'/overview\', title: txt(o.querySelector(\'h2\')),\n      jobNumber: (txt(o.body).match(/Job #:\\s*(\\d+)/) || [])[1] || \'\',\n      customer: link(\'customerid\'), scheduledStart: link(\'start_date\'), scheduledEnd: link(\'end_date\'),\n      address: txt(o.querySelector(\'button[aria-label="Jobsite location actions"]\')),\n    },\n    tasks, files: [...new Map(files.map((x) => [x.url, x])).values()], forms,\n  };\n  const a = document.createElement(\'a\');\n  a.href = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: \'application/json\' }));\n  a.download = \'simplysub-job-\' + id + \'.json\';\n  a.click();\n  setTimeout(() => URL.revokeObjectURL(a.href), 1000);\n  alert(\'SimplySub job \' + id + \' downloaded. Upload it in FAJ Imports.\');\n})().catch((e) => alert(e.message || \'Could not copy this job.\'));';

export const SIMPLYSUB_BOOKMARKLET = `javascript:${encodeURIComponent(SIMPLYSUB_COPY_SCRIPT)}`;
