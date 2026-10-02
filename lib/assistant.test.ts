import { describe, it, expect } from 'vitest';
import {
  jobStatusLabel, isClosedJob, jobPlace, jobAddress, mergeWork, crewStatusLabel, workBucket,
  groupWork, todayEastern, openTaskCount, matchesWork, staffReasonText, sectionForRole, ROLES,
  type AssistantJob, type AssistantCrewSite, type StaffTask,
} from './assistant';

const job = (over: Partial<AssistantJob>): AssistantJob => ({
  id: 'j', wo_number: '19101293', title: 'Network install', description: null, status: 'Assigned',
  priority: null, service_type: null, customer_name: "Wendy's", project_name: null, client_reference: null,
  source_platform: null, external_wo_id: null, site_name: "Wendy's #412", site_address: '12 Main St',
  site_city: 'Easton', site_state: 'PA', site_zip: '18042', scheduled_date: null, start_date: null,
  end_date: null, start_time: null, end_time: null, time_zone: null, techs: ['Davis'], lead_tech: null,
  poc_name: null, poc_phone: null, poc_email: null, access_instructions: null, parking_instructions: null,
  special_instructions: null, scope_of_work: null, deliverables: null, tools_required: null,
  required_skills: null, travel_start_at: null, arrived_at: null, checked_in_at: null, checked_out_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

const site = (over: Partial<AssistantCrewSite>): AssistantCrewSite => ({
  id: 's', project: 'LDS Meetinghouse Refresh', client: 'NetView', team: 'Team Fred', lead: 'Fred',
  helper: null, week_start: '2026-10-26', survey_date: '2026-10-06', name: 'Rockingham Meetinghouse',
  address: '310 Roberdell Road', city: 'Rockingham', state: 'NC', zip: '28379', property_id: '5330467',
  status: 'scheduled',
  ...over,
});

describe('job status an assistant sees', () => {
  it('shows the pay steps as simply Closed', () => {
    expect(jobStatusLabel('Approved')).toBe('Closed');
    expect(jobStatusLabel('Paid')).toBe('Closed');
    expect(isClosedJob({ status: 'Paid' })).toBe(true);
  });
  it('keeps the working statuses readable', () => {
    expect(jobStatusLabel('Open')).toBe('Open');
    expect(jobStatusLabel('Assigned')).toBe('Assigned');
    expect(jobStatusLabel('Work Done')).toBe('Work done');
    expect(jobStatusLabel(null)).toBe('Open');
  });
});

describe('where a job is', () => {
  it('reads site then town', () => {
    expect(jobPlace(job({}))).toBe("Wendy's #412 · Easton, PA");
    expect(jobPlace(job({ site_name: null }))).toBe('12 Main St · Easton, PA');
  });
  it('builds a full address for maps', () => {
    expect(jobAddress(job({}))).toBe('12 Main St, Easton, PA 18042');
    expect(jobAddress(job({ site_address: null, site_city: null, site_state: null, site_zip: null }))).toBe('');
  });
});

describe('one work list', () => {
  it('puts work orders and crew sites together by date, unscheduled last', () => {
    const items = mergeWork(
      [job({ id: 'a', scheduled_date: '2026-10-30' }), job({ id: 'b', scheduled_date: null })],
      [site({ id: 'c', week_start: '2026-10-26' })],
    );
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(items[0].kind).toBe('crew');
    expect(items[0].who).toBe('Fred');
    expect(items[2].who).toBe('Davis');
  });
  it('says plainly when nobody is on the job yet', () => {
    const [i] = mergeWork([job({ techs: [] })], []);
    expect(i.who).toBe('No tech yet');
  });
  it('labels crew site status', () => {
    expect(crewStatusLabel('in_progress')).toBe('In progress');
    expect(crewStatusLabel(null)).toBe('Scheduled');
    expect(crewStatusLabel('done')).toBe('Done');
  });
});

describe('grouping by day', () => {
  const today = '2026-10-02';
  it('buckets dates around today', () => {
    expect(workBucket('2026-10-02', today)).toBe('today');
    expect(workBucket('2026-10-08', today)).toBe('week');
    expect(workBucket('2026-10-09', today)).toBe('later');
    expect(workBucket('2026-09-30', today)).toBe('past');
    expect(workBucket(null, today)).toBe('unscheduled');
  });
  it('drops closed and finished work, keeps the order today → later → unscheduled → past', () => {
    const items = mergeWork(
      [
        job({ id: 'today', scheduled_date: today }),
        job({ id: 'closed', scheduled_date: today, status: 'Paid' }),
        job({ id: 'none', scheduled_date: null }),
        job({ id: 'old', scheduled_date: '2026-09-01' }),
      ],
      [site({ id: 'done', week_start: '2026-10-05', status: 'done' }), site({ id: 'soon', week_start: '2026-10-05' })],
    );
    const groups = groupWork(items, today);
    expect(groups.map((g) => g.bucket)).toEqual(['today', 'week', 'unscheduled', 'past']);
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual(['today', 'soon', 'none', 'old']);
  });
});

describe('small things', () => {
  it("knows today's date in Eastern time, not UTC", () => {
    // 1:30 AM UTC on Oct 3 is still 9:30 PM Oct 2 in Easton.
    expect(todayEastern(new Date('2026-10-03T01:30:00Z'))).toBe('2026-10-02');
  });
  it('counts open tasks', () => {
    const t = (status: StaffTask['status']): StaffTask => ({
      id: status, title: 't', details: null, due_date: null, status, done_at: null, done_note: null, created_at: '',
    });
    expect(openTaskCount([t('open'), t('done'), t('open')])).toBe(2);
  });
  it('searches the words an assistant would type', () => {
    const [w] = mergeWork([job({})], []);
    const [c] = mergeWork([], [site({})]);
    expect(matchesWork(w, 'wendy')).toBe(true);
    expect(matchesWork(w, 'easton')).toBe(true);
    expect(matchesWork(c, '5330467')).toBe(true);
    expect(matchesWork(c, 'wendy')).toBe(false);
    expect(matchesWork(c, '  ')).toBe(true);
  });
  it('turns every reason code into plain English', () => {
    expect(staffReasonText('own_email')).toMatch(/own email/);
    expect(staffReasonText('something_new')).toMatch(/went wrong/);
  });
});

describe('roles', () => {
  it('sends each staff role to its own section, and an unknown role nowhere', () => {
    expect(sectionForRole('assistant')).toBe('/assistant');
    expect(sectionForRole('accountant')).toBeNull();
    expect(sectionForRole(undefined)).toBeNull();
  });
  it('only offers roles that have a section to sign in to', () => {
    for (const r of ROLES.filter((x) => x.canAdd)) {
      expect(sectionForRole(r.key), r.key).not.toBeNull();
    }
  });
  it('lists owner, tech, assistant, accountant and developer', () => {
    expect(ROLES.map((r) => r.key)).toEqual(['owner', 'tech', 'assistant', 'accountant', 'developer']);
  });
});
