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
