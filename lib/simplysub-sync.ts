import { parseHTML } from 'linkedom';
import type { CustomQAItem, WoTask } from './types';
import { parseSimplySubPackage, type SimplySubPackage } from './simplysub';

const BASE = 'https://app.simplysub.com';
const absoluteUrl = (url: string) => url ? new URL(url, BASE).toString() : '';
const dom = (html: string) => {
  const documentHtml = /<html[\s>]/i.test(html)
    ? html
    : /<body[\s>]/i.test(html)
      ? `<html>${html}</html>`
      : `<html><body>${html}</body></html>`;
  return parseHTML(documentHtml).document as unknown as Document;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SimplySubSyncSummary = {
  jobId: string;
  siteNumber: string;
  title: string;
  status: string;
  percentComplete: number | null;
  syncedAt: string;
  sourceUrl: string;
  reportUrl: string;
  laborHours: number;
  workEntries: number;
  completedTasks: number;
  noteCount: number;
  fileCount: number;
  expenseTotal: number;
  assignmentCount: number;
  labor: { employee: string; hours: number }[];
  notes: { by: string; date: string; category: string; note: string }[];
  files: { name: string; category: string; date: string; sizeKb: number; url: string }[];
  expenses: { date: string; supplier: string; category: string; description: string; amount: number }[];
  assignments: string[];
  forms: { name: string; status: string; startedBy: string; startedAt: string; url: string }[];
};

export type SimplySubSyncJob = {
  package: SimplySubPackage;
  fields: ReturnType<typeof parseSimplySubPackage>;
  summary: SimplySubSyncSummary;
};

export type SimplySubFormInspection = {
  jobId: string;
  siteNumber: string;
  forms: {
    title: string;
    status: string;
    links: { text: string; href: string }[];
    actions: { tag: string; text: string; attrs: Record<string, string> }[];
  }[];
  submissionPages: {
    path: string;
    forms: {
      action: string;
      method: string;
      enctype: string;
      attrs: Record<string, string>;
      fields: { name: string; type: string; multiple: boolean }[];
    }[];
    actions: { tag: string; text: string; attrs: Record<string, string> }[];
    formPaths: string[];
    scripts: string[];
    inlineScripts: string[];
    options: { field: string; value: string; text: string }[];
  }[];
};

const text = (node: Node | null | undefined) =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim();

const number = (value: string | undefined) => {
  const parsed = Number((value ?? '').replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

const reportMetric = (report: Document, label: string) => {
  const compactLabel = label.replace(/\s+/g, '').toLowerCase();
  const summaryCard = [...report.querySelectorAll('.dl-summary-grid .card')]
    .find((card) => text(card.querySelector('p')).replace(/\s+/g, '').toLowerCase() === compactLabel);
  if (summaryCard) return number(text(summaryCard.querySelector('h5')));
  const body = text(report.body);
  const match = body.match(new RegExp(`${label}\\s*([\\d,.]+|\\$[\\d,.]+)`, 'i'));
  return number(match?.[1]);
};

const rows = (table: Element | null) =>
  [...(table?.querySelectorAll('tbody tr') ?? [])].map((row) =>
    [...row.querySelectorAll('td')].map((cell) => text(cell)),
  ).filter((cells) => cells.length);

export function parseSimplySubSyncPages(args: {
  jobId: string;
  siteNumber: string;
  overviewHtml: string;
  tasksHtml: string;
  filesHtml: string;
  formsHtml: string;
  reportHtml: string;
  deliverableLink?: string | null;
  now?: Date;
}): SimplySubSyncJob {
  const overview = dom(args.overviewHtml);
  const tasks = dom(args.tasksHtml);
  const files = dom(args.filesHtml);
  const forms = dom(args.formsHtml);
  const report = dom(args.reportHtml);
  const now = args.now ?? new Date();

  const title = text(overview.querySelector('h2'));
  const overviewText = text(overview.body);
  const property = (name: string) =>
    text(overview.querySelector(`a[href*="go_to_property=${name}"]`));
  const sourceUrl = `${BASE}/jobs/${args.jobId}/overview`;
  const status = property('status');
  const percentText = property('percent_complete');

  const taskGroups = [...tasks.querySelectorAll<HTMLInputElement>('input[aria-label^="Complete "]')].map((input) => {
    const taskTitle = (input.getAttribute('aria-label') ?? '').replace(/^Complete\s+/, '').trim();
    const parentId = input.getAttribute('onchange')?.match(/toggleObjectTask\(\d+,\s*(\d+)/)?.[1];
    const items = parentId
      ? [...tasks.querySelectorAll(`.object-subtask-row[data-parent-task-itemid="${parentId}"] .object-subtask-title`)]
        .map((node) => text(node))
        .filter(Boolean)
      : [];
    return { title: taskTitle, items: [...new Set(items)] };
  });

  const sourceFiles = [...files.querySelectorAll<HTMLElement>('[data-original-url], a[href*="cdn.simplysub.com"]')]
    .map((node) => {
      const url = absoluteUrl(node.getAttribute('data-original-url') || node.getAttribute('href') || '');
      const card = node.closest('.file-tile') ?? node.parentElement?.parentElement;
      const name = text(card?.querySelector('.file-tile-title, .file-title'))
        || node.getAttribute('data-preview-title')
        || decodeURIComponent(url.split('/').pop() ?? 'Document');
      const category = card?.getAttribute('data-doctype')
        || text(card?.querySelector('.file-tile-meta span'))
        || undefined;
      return { name, url, category };
    })
    .filter((file) => /^https:\/\/cdn\.simplysub\.com\//i.test(file.url));

  const formRows = [...forms.querySelectorAll<HTMLElement>('[data-form-row]')];
  const formLinks = formRows.map((row) => {
    const href = absoluteUrl(row.querySelector('a[href*="/forms/submissions/"]')?.getAttribute('href') ?? '');
    return { title: text(row.querySelector('.ss-forms-title')), url: href };
  }).filter((form) => form.url);

  const pkg: SimplySubPackage = {
    version: 2,
    source: 'SimplySub automatic sync',
    job: {
      id: args.jobId,
      url: sourceUrl,
      title,
      jobNumber: overviewText.match(/Job #:\s*(\d+)/i)?.[1] ?? '',
      customer: property('customerid'),
      scheduledStart: property('start_date'),
      scheduledEnd: property('end_date'),
      address: text(overview.querySelector('button[aria-label="Jobsite location actions"]')),
    },
    tasks: taskGroups,
    files: [...new Map(sourceFiles.map((file) => [file.url, file])).values()],
    forms: formLinks,
  };

  const laborTable = report.querySelector('.dl-labor-table');
  const noteTable = report.querySelector('.dl-notes-table');
  const expenseTable = report.querySelector('.dl-expense-table');
  const reportFiles = [...report.querySelectorAll<HTMLElement>('.file-tile')].map((card) => ({
    name: card.getAttribute('data-title') || text(card.querySelector('.file-tile-title')),
    category: card.getAttribute('data-doctype') || '',
    date: card.getAttribute('data-date') || '',
    sizeKb: number(card.getAttribute('data-size') || ''),
    url: card.querySelector<HTMLElement>('[data-original-url]')?.getAttribute('data-original-url')
      || card.querySelector('a[href^="https://cdn.simplysub.com"]')?.getAttribute('href')
      || '',
  }));
  const notes = [...(noteTable?.querySelectorAll('tbody tr') ?? [])].map((row) => {
    const cells = [...row.querySelectorAll('td')];
    return {
      by: text(cells[0]?.childNodes[0]),
      date: text(cells[0]?.querySelector('.small')),
      category: text(cells[1]),
      note: text(cells[2]),
    };
  });
  const expenses = rows(expenseTable).map((cells) => ({
    date: cells[0] ?? '',
    supplier: cells[2] ?? '',
    category: cells[3] ?? '',
    description: cells[4] ?? '',
    amount: number(cells[5]),
  }));
  const labor = rows(laborTable)
    .filter((cells) => cells[0] && !/grand total/i.test(cells[0]))
    .map((cells) => ({ employee: cells[0], hours: number(cells[1]) }));
  const assignments = [...report.querySelectorAll('.ss-name')].map((node) => text(node)).filter(Boolean);

  const summary: SimplySubSyncSummary = {
    jobId: args.jobId,
    siteNumber: args.siteNumber,
    title,
    status,
    percentComplete: percentText ? number(percentText) : null,
    syncedAt: now.toISOString(),
    sourceUrl,
    reportUrl: `${BASE}/reports/jobs/daily-work-log-detail?jobid=${args.jobId}`,
    laborHours: reportMetric(report, 'Labor Hours'),
    workEntries: reportMetric(report, 'Work Entries'),
    completedTasks: reportMetric(report, 'Completed Tasks'),
    noteCount: reportMetric(report, 'Job Notes'),
    fileCount: reportMetric(report, 'Files & Photos'),
    expenseTotal: reportMetric(report, 'Job Expenses'),
    assignmentCount: reportMetric(report, 'Job Assignments'),
    labor,
    notes,
    files: reportFiles,
    expenses,
    assignments,
    forms: formRows.map((row) => ({
      name: text(row.querySelector('.ss-forms-title')),
      status: row.getAttribute('data-status') ?? '',
      startedBy: text(row.querySelector('.ss-form-meta strong')) === 'Started by'
        ? text(row.querySelector('.ss-form-meta')).replace(/^Started by\s*/i, '')
        : '',
      startedAt: row.querySelector('time')?.getAttribute('data-utc-date') ?? '',
      url: absoluteUrl(row.querySelector('a[href*="/forms/submissions/"]')?.getAttribute('href') ?? ''),
    })),
  };

  return {
    package: pkg,
    fields: parseSimplySubPackage(pkg, args.deliverableLink ?? undefined),
    summary,
  };
}

class SimplySubSession {
  private cookies = new Map<string, string>();

  constructor(private readonly fetcher: FetchLike = fetch) {}

  private remember(response: Response) {
    const values = response.headers.getSetCookie?.() ?? [];
    for (const value of values) {
      const first = value.split(';', 1)[0];
      const index = first.indexOf('=');
      if (index > 0) this.cookies.set(first.slice(0, index), first.slice(index + 1));
    }
  }

  private async request(path: string, init: RequestInit = {}, redirects = 0): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) {
      headers.set('cookie', [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; '));
    }
    headers.set('user-agent', 'FAJ Solutions SimplySub Sync/1.0');
    const response = await this.fetcher(new URL(path, BASE), { ...init, headers, redirect: 'manual' });
    this.remember(response);
    if (response.status >= 300 && response.status < 400 && redirects < 5) {
      const location = response.headers.get('location');
      if (location) return this.request(location, { method: 'GET' }, redirects + 1);
    }
    return response;
  }

  async login(email: string, password: string) {
    await this.request('/login');
    const response = await this.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ login_identifier: email, password, next_url: '' }),
    });
    if (!response.ok || response.status !== 204) {
      throw new Error('SimplySub sign-in failed. Check the saved email and password.');
    }
  }

  async html(path: string) {
    const response = await this.request(path);
    const html = await response.text();
    if (!response.ok) throw new Error(`SimplySub returned ${response.status} for ${path}.`);
    if (response.url.includes('/login') || /name=["']password["']/i.test(html)) {
      throw new Error('SimplySub signed out during the sync.');
    }
    return html;
  }
}

const actionAttrs = (node: Element) => Object.fromEntries(
  ['action', 'method', 'enctype', 'href', 'hx-get', 'hx-post', 'hx-put', 'data-url', 'data-action']
    .map((name) => [name, node.getAttribute(name) ?? ''] as const)
    .filter(([, value]) => value),
);

const pageActions = (document: Document) => [...document.querySelectorAll('a[href], button, form')]
  .map((node) => ({
    tag: node.tagName.toLowerCase(),
    text: text(node).slice(0, 120),
    attrs: actionAttrs(node),
  }))
  .filter((row) => Object.keys(row.attrs).length > 0);

/**
 * Read-only structure probe for the authenticated job form pages. This exposes
 * endpoint and field names, never cookies, passwords, CSRF values, or answers.
 */
export async function inspectSimplySubFormsBySiteNumber(
  email: string,
  password: string,
  wantedSiteNumber: string,
): Promise<SimplySubFormInspection> {
  const session = new SimplySubSession();
  await session.login(email, password);
  const quickSelect = dom(await session.html('/jobs/quick-select'));
  const match = [...quickSelect.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/"][href$="/overview"]')]
    .map((link) => {
      const href = link.getAttribute('href') ?? '';
      return {
        jobId: href.match(/\/jobs\/(\d+)\/overview/)?.[1] ?? '',
        siteNumber: text(link).match(/\b(\d{7})\b/)?.[1] ?? '',
      };
    })
    .find((job) => job.jobId && job.siteNumber === wantedSiteNumber);
  if (!match) throw new Error(`SimplySub site ${wantedSiteNumber} was not found.`);

  const formsDocument = dom(await session.html(`/object/3/object-record/${match.jobId}/forms`));
  const forms = [...formsDocument.querySelectorAll<HTMLElement>('[data-form-row]')].map((row) => ({
    title: text(row.querySelector('.ss-forms-title')),
    status: row.getAttribute('data-status') ?? '',
    links: [...row.querySelectorAll<HTMLAnchorElement>('a[href]')].map((link) => ({
      text: text(link).slice(0, 120),
      href: link.getAttribute('href') ?? '',
    })),
    actions: pageActions(row as unknown as Document),
  }));

  const paths = [...new Set([
    ...forms.flatMap((form) => form.links.map((link) => link.href))
      .filter((href) => /^\/forms\/submissions\/\d+(?:[/?#]|$)/.test(href)),
    '/forms/choose',
    `/jobs/${match.jobId}/overview`,
    `/jobs/${match.jobId}/files`,
    '/views/daily-logs/search',
  ])];
  const submissionPages = [];
  for (const path of paths.slice(0, 8)) {
    const html = await session.html(path);
    const document = dom(html);
    submissionPages.push({
      path,
      forms: [...document.querySelectorAll<HTMLFormElement>('form')].map((form) => ({
        action: form.getAttribute('action') ?? '',
        method: form.getAttribute('method') ?? '',
        enctype: form.getAttribute('enctype') ?? '',
        attrs: actionAttrs(form),
        fields: [...form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input[name], select[name], textarea[name]')]
          .map((field) => ({
            name: field.getAttribute('name') ?? '',
            type: field.getAttribute('type') ?? field.tagName.toLowerCase(),
            multiple: field.hasAttribute('multiple'),
          })),
      })),
      actions: pageActions(document),
      formPaths: [...new Set([...html.matchAll(/["'`](\/[^"'`]*forms[^"'`]*)["'`]/gi)].map((m) => m[1]))].slice(0, 100),
      scripts: [...document.querySelectorAll<HTMLScriptElement>('script[src]')]
        .map((script) => script.getAttribute('src') ?? '')
        .filter(Boolean),
      inlineScripts: [...document.querySelectorAll<HTMLScriptElement>('script')]
        .filter((script) => !script.hasAttribute('src'))
        .flatMap((script) => (script.textContent ?? '').split('\n'))
        .map((line) => line.trim())
        .filter((line) => /fetch\(|\/api\/|\/forms\/|\/jobs\/|upload|daily|note|attach|htmx\.ajax/i.test(line))
        .filter((line) => !/csrf|token|password|secret|cookie/i.test(line))
        .map((line) => line.slice(0, 300))
        .slice(0, 80),
      options: [...document.querySelectorAll<HTMLOptionElement>('select[name] option')]
        .map((option) => ({
          field: option.closest('select')?.getAttribute('name') ?? '',
          value: option.getAttribute('value') ?? '',
          text: text(option).slice(0, 120),
        }))
        .slice(0, 100),
    });
  }
  return { ...match, forms, submissionPages };
}

export async function findSimplySubJobsBySiteNumber(email: string, password: string, now = new Date()) {
  const session = new SimplySubSession();
  await session.login(email, password);
  const quickSelect = dom(await session.html('/jobs/quick-select'));
  const matches = [...quickSelect.querySelectorAll<HTMLAnchorElement>('a[href*="/jobs/"][href$="/overview"]')]
    .map((link) => {
      const jobId = link.getAttribute('href')?.match(/\/jobs\/(\d+)\/overview/)?.[1] ?? '';
      const title = text(link);
      const siteNumber = title.match(/\b(\d{7})\b/)?.[1] ?? '';
      return { jobId, siteNumber };
    })
    .filter((job) => job.jobId && job.siteNumber);

  const dateTo = dateOnly(now);
  const dateFrom = `${now.getUTCFullYear() - 2}-01-01`;
  return {
    matches,
    load: async (job: { jobId: string; siteNumber: string }, deliverableLink?: string | null) => {
      const [overviewHtml, tasksHtml, filesHtml, formsHtml, reportHtml] = await Promise.all([
        session.html(`/jobs/${job.jobId}/overview`),
        session.html(`/jobs/${job.jobId}/tasks`),
        session.html(`/jobs/${job.jobId}/files`),
        session.html(`/object/3/object-record/${job.jobId}/forms`),
        session.html(`/reports/jobs/daily-work-log-detail?jobid=${job.jobId}&date_from=${dateFrom}&date_to=${dateTo}`),
      ]);
      return parseSimplySubSyncPages({
        ...job,
        overviewHtml,
        tasksHtml,
        filesHtml,
        formsHtml,
        reportHtml,
        deliverableLink,
        now,
      });
    },
  };
}

const personKey = (name: string) => name.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);

export const isSimplySubTech = (name: string, techNames: string[]) => {
  const person = personKey(name);
  if (person.length < 2) return false;
  return techNames.some((techName) => {
    const tech = personKey(techName);
    if (tech.length < 2 || tech[tech.length - 1] !== person[person.length - 1]) return false;
    return tech[0].startsWith(person[0]) || person[0].startsWith(tech[0]);
  });
};

const isMileage = (expense: { category: string; description: string }) =>
  /\bmile(age|s)?\b/i.test(`${expense.category} ${expense.description}`);

export function filterSimplySubSummaryToTechs(
  summary: SimplySubSyncSummary,
  techNames: string[],
): SimplySubSyncSummary & { techOnly: true; excludedPeople: number } {
  const tech = (name: string) => isSimplySubTech(name, techNames);
  const labor = summary.labor.filter((row) => tech(row.employee));
  const notes = summary.notes.filter((note) => tech(note.by));
  const assignments = summary.assignments.filter(tech);
  const expenses = summary.expenses.filter((expense) => !isMileage(expense));
  const people = new Set([
    ...summary.labor.map((row) => row.employee),
    ...summary.notes.map((note) => note.by),
    ...summary.assignments,
  ].filter(Boolean));
  return {
    ...summary,
    labor,
    notes,
    assignments,
    expenses,
    forms: summary.forms.filter((form) => !form.startedBy || tech(form.startedBy)),
    laborHours: Math.round(labor.reduce((sum, row) => sum + row.hours, 0) * 100) / 100,
    noteCount: notes.length,
    assignmentCount: assignments.length,
    expenseTotal: Math.round(expenses.reduce((sum, expense) => sum + expense.amount, 0) * 100) / 100,
    techOnly: true,
    excludedPeople: [...people].filter((name) => !tech(name)).length,
  };
}

export const mergeSimplySubItems = <T>(
  current: T[] | null | undefined,
  incoming: T[],
  key: (value: T) => string,
): T[] => {
  const seen = new Set((current ?? []).map((value) => key(value).toLowerCase()));
  return [...(current ?? []), ...incoming.filter((value) => {
    const valueKey = key(value).toLowerCase();
    if (!valueKey || seen.has(valueKey)) return false;
    seen.add(valueKey);
    return true;
  })];
};

export function mergeSimplySubWorkflow(
  current: { wo_tasks?: WoTask[] | null; custom_qa?: CustomQAItem[] | null },
  incoming: { wo_tasks?: WoTask[]; custom_qa?: CustomQAItem[] },
) {
  return {
    wo_tasks: mergeSimplySubItems(current.wo_tasks, incoming.wo_tasks ?? [], (task) => task.label),
    custom_qa: mergeSimplySubItems(current.custom_qa, incoming.custom_qa ?? [], (question) => question.label),
  };
}
