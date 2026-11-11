import { describe, expect, it } from 'vitest';
import { filterSimplySubSummaryToTechs, isSimplySubTech, mergeSimplySubWorkflow, parseSimplySubSyncPages } from './simplysub-sync';
import type { WoTask } from './types';

const overview = `
  <h2>LDS - 5006902 - WILMINGTON NC</h2>
  <div>Job #: 26</div>
  <a href="?go_to_property=status">Pending Hours</a>
  <a href="?go_to_property=percent_complete">75%</a>
  <a href="?go_to_property=customerid">LDS - Compucom</a>
  <a href="?go_to_property=start_date">11/09/2026</a>
  <a href="?go_to_property=end_date">11/13/2026</a>
  <button aria-label="Jobsite location actions">514 South College Road, WILMINGTON, NC 28412</button>`;
const tasks = `
  <input aria-label="Complete LDS - Day 1" onchange="toggleObjectTask(103, 3825, 1)">
  <div class="object-subtask-row" data-parent-task-itemid="3825"><span class="object-subtask-title">Walkthrough complete</span></div>
  <input aria-label="Complete AP-01 Install" onchange="toggleObjectTask(103, 3900, 1)">
  <div class="object-subtask-row" data-parent-task-itemid="3900"><span class="object-subtask-title">Cable pulled</span></div>`;
const files = `<div class="file-tile" data-doctype="Before"><a data-original-url="https://cdn.simplysub.com/a/photo.jpg" data-preview-title="Photo"></a></div>`;
const forms = `<div data-form-row data-status="Complete"><div class="ss-forms-title">Checkout</div><span class="ss-form-meta"><strong>Started by</strong> Paul</span><time data-utc-date="2026-11-13T20:00:00"></time><a href="/forms/submissions/73">View</a></div>`;
const report = `
  <body>Labor Hours 8.5 Work Entries 2 Completed Tasks 7 Job Notes 1 Files & Photos 4 Job Expenses $252.50 Job Assignments 2
  <table class="dl-labor-table"><tbody><tr><td>Paul Gibbs</td><td>8.5</td></tr><tr><td>Grand Total</td><td>8.5</td></tr></tbody></table>
  <table class="dl-notes-table"><tbody><tr><td>Paul</td><td>2026-11-13</td><td>General</td><td>Complete</td></tr></tbody></table>
  <div class="file-tile" data-title="after.jpg" data-doctype="After" data-date="2026-11-13" data-size="240"><a data-original-url="https://cdn.simplysub.com/a/after.jpg"></a></div>
  <table class="dl-expense-table"><tbody><tr><td>2026-11-13</td><td>0</td><td>TRS</td><td>Rental</td><td>Tester</td><td>$252.50</td></tr></tbody></table>
  <div class="ss-name">Paul Gibbs</div><div class="ss-name">Raja Bennett</div></body>`;

describe('SimplySub automatic sync', () => {
  it('parses billing and checkout monitoring data by site number', () => {
    const result = parseSimplySubSyncPages({
      jobId: '3123',
      siteNumber: '5006902',
      overviewHtml: overview,
      tasksHtml: tasks,
      filesHtml: files,
      formsHtml: forms,
      reportHtml: report,
      now: new Date('2026-11-13T20:00:00Z'),
    });
    expect(result.fields.client_reference).toBe('26');
    expect(result.fields.description).toContain('AP-01 Install');
    expect(result.summary).toMatchObject({
      siteNumber: '5006902',
      status: 'Pending Hours',
      percentComplete: 75,
      laborHours: 8.5,
      completedTasks: 7,
      expenseTotal: 252.5,
      assignments: ['Paul Gibbs', 'Raja Bennett'],
    });
    expect(result.summary.forms[0]).toMatchObject({ name: 'Checkout', status: 'Complete' });
    expect(result.summary.expenses[0].category).toBe('Rental');
  });

  it('keeps FAJ completion state while adding new SimplySub checklist items', () => {
    const current: WoTask[] = [{ id: 'old', category: 'On Site', label: 'Existing', completed: true, completed_at: 'now' }];
    const incoming: WoTask[] = [
      { id: 'replace', category: 'On Site', label: 'Existing', completed: false, completed_at: null },
      { id: 'new', category: 'On Site', label: 'New', completed: false, completed_at: null },
    ];
    expect(mergeSimplySubWorkflow({ wo_tasks: current, custom_qa: [] }, { wo_tasks: incoming, custom_qa: [] }).wo_tasks)
      .toEqual([current[0], incoming[1]]);
  });

  it('keeps only FAJ technicians and leaves mileage to the FAJ app', () => {
    const { summary } = parseSimplySubSyncPages({
      jobId: '3123',
      siteNumber: '5006902',
      overviewHtml: overview,
      tasksHtml: tasks,
      filesHtml: files,
      formsHtml: forms,
      reportHtml: report,
    });
    const filtered = filterSimplySubSummaryToTechs({
      ...summary,
      labor: [{ employee: 'Paul Gibbs', hours: 6 }, { employee: 'Kinniard Brooks', hours: 4.45 }, { employee: 'Fred Jeffers', hours: 1 }],
      notes: [{ by: 'Mike Wise', date: '2026-10-05', category: 'General', note: 'Codes' }, { by: 'Paul Gibbs', date: '2026-11-09', category: 'General', note: 'Done' }],
      assignments: ['Paul Gibbs', 'Someone Else'],
      expenses: [
        { date: '2026-11-08', supplier: 'TRS Rentco', category: 'Rental', description: 'Certifier', amount: 252.5 },
        { date: '2026-11-08', supplier: '', category: 'Mileage', description: '120 miles', amount: 80 },
      ],
    }, ['Paul Gibbs', 'Frederick Jeffers', 'Raja Bennett']);
    expect(filtered.labor.map((row) => row.employee)).toEqual(['Paul Gibbs', 'Fred Jeffers']);
    expect(filtered.laborHours).toBe(7);
    expect(filtered.notes.map((note) => note.by)).toEqual(['Paul Gibbs']);
    expect(filtered.assignments).toEqual(['Paul Gibbs']);
    expect(filtered.expenses).toHaveLength(1);
    expect(filtered.expenseTotal).toBe(252.5);
    expect(filtered.excludedPeople).toBe(3);
    expect(filtered.forms).toHaveLength(0);
  });

  it('matches people by last name and first-name nickname only', () => {
    expect(isSimplySubTech('Fred Jeffers', ['Frederick Jeffers'])).toBe(true);
    expect(isSimplySubTech('Paul Smith', ['Paul Gibbs'])).toBe(false);
    expect(isSimplySubTech('Paul', ['Paul Gibbs'])).toBe(false);
  });
});
