// What each screen shows (Settings -> What each screen shows; Fred,
// 2026-10-05: "full admin privilege in settings"). Each part of the
// Dashboard, Dispatch and the job page can be switched off. Saved with the menu
// layout (user_settings.layout `off`, lib/app-layout.ts); everything is on as
// standard. Switching a part off only hides it — nothing is lost.

export type ScreenPart = { key: string; label: string; hint: string };
export type ScreenParts = { screen: string; hint: string; parts: ScreenPart[] };

export const SCREEN_PARTS: ScreenParts[] = [
  {
    screen: 'Dashboard',
    hint: 'The first screen after you sign in',
    parts: [
      { key: 'dash.attention', label: 'Needs your attention', hint: 'Quotes, invoices and visits waiting on you' },
      { key: 'dash.kpis', label: 'Money tiles', hint: 'Revenue, owed to techs, profit and paid out' },
      { key: 'dash.status', label: 'Job counts', hint: 'How many jobs are open, done and paid' },
      { key: 'dash.outstanding', label: 'Outstanding jobs', hint: 'Jobs with tech pay still owed' },
      { key: 'dash.payments', label: 'Recent payments', hint: 'The last payments sent to techs' },
    ],
  },
  {
    screen: 'Dispatch',
    hint: 'The job board',
    parts: [
      { key: 'dispatch.tiles', label: 'Count tiles', hint: 'Total jobs, each stage and High priority, across the top' },
      { key: 'dispatch.alerts', label: 'Waiting on you', hint: 'Expenses and time requests from techs' },
      { key: 'card.priority', label: 'Job cards: priority', hint: '' },
      { key: 'card.client', label: 'Job cards: client', hint: '' },
      { key: 'card.place', label: 'Job cards: town', hint: '' },
      { key: 'card.price', label: 'Job cards: price', hint: 'What the client pays' },
      { key: 'card.when', label: 'Job cards: date and start time', hint: '' },
      { key: 'card.techs', label: 'Job cards: who is assigned', hint: '' },
      { key: 'card.counts', label: 'Job cards: progress, hours, messages and photos', hint: '% of the checklist done, hours worked, and how many messages and photos' },
      { key: 'card.type', label: 'Job cards: work type', hint: '' },
    ],
  },
  {
    screen: 'Job page',
    hint: 'What you see when you open a job',
    parts: [
      { key: 'job.timeRequests', label: 'Time requests', hint: 'A tech asking for another day or time' },
      { key: 'job.quickEdit', label: 'Quick changes', hint: 'Change the date, time or price without the full form' },
      { key: 'job.techs', label: 'Techs', hint: 'Who is on the job' },
      { key: 'job.money', label: 'Money', hint: 'Price, tech pay and profit' },
      { key: 'job.fields', label: 'Your fields', hint: 'Your custom fields, when filled in' },
      { key: 'job.closeout', label: 'Closeout', hint: 'Deliverables, delays and sign-off' },
      { key: 'job.project', label: 'Project day', hint: 'On a project site: travel, time on site, lunch, miles, receipts and the client report' },
      { key: 'job.notes', label: 'Notes', hint: 'Office notes with a date and kind — techs never see them' },
      { key: 'job.report', label: "Tech's report", hint: 'Answers and notes the tech saved' },
      { key: 'job.expenses', label: 'Expenses', hint: 'Receipts techs sent on this job' },
      { key: 'job.photos', label: 'Photos', hint: 'Photos from the job' },
      { key: 'job.docs', label: 'Documents', hint: 'PDFs techs scanned on the job' },
      { key: 'job.sketches', label: 'Sketches', hint: 'Floor plans and layouts drawn for this job' },
      { key: 'job.timegps', label: 'Time & GPS', hint: 'When each tech clocked in and out, and where' },
    ],
  },
];

export const PART_KEYS: string[] = SCREEN_PARTS.flatMap((s) => s.parts.map((p) => p.key));

// The parts switched off right now — set by the owner app from Fred's layout
// (components/useAppLayout). The tech portal never sets it, so it shows everything.
let off = new Set<string>();
export function setPartsOffNow(keys: string[]): void { off = new Set(keys); }

/** Whether a part of a screen is switched on (everything is, as standard). */
export function shown(key: string): boolean {
  return !off.has(key);
}
