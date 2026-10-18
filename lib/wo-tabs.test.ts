import { describe, expect, it } from 'vitest';
import { tabsInUse, type TabFacts } from './wo-tabs';

const blank: TabFacts = {
  saved: false, techs: 0, docs: 0, pay: null, payLines: 0, payments: 0,
  site: [], scope: [], tasks: 0, contacts: 0, poc: [], questions: 0, materials: 0,
};

describe('tabs on the Edit work order window', () => {
  it('a new job starts with Details only', () => {
    expect(tabsInUse(blank)).toEqual(['details']);
  });

  it('empty values and the Internal platform do not count', () => {
    expect(tabsInUse({ ...blank, site: ['', '  ', null], client: { platform: 'Internal' }, pay: { Davis: 0 } })).toEqual(['details']);
  });

  it('a tab shows once it has something in it', () => {
    const t = tabsInUse({
      ...blank, saved: true, status: 'Work Done', techs: 1, docs: 2, client: { customer: 'NetView' },
      pay: { Davis: 250 }, payments: 1, site: ['Gaffney'], scope: ['Bring a ladder'],
      contacts: 1, questions: 1, materials: 1,
    });
    expect(t).toEqual(['details', 'documents', 'chat', 'marketplace', 'pay', 'payments', 'timelog', 'site', 'scope', 'contacts', 'questions', 'closeout']);
  });

  it('chat and time logs only on a saved job, and time logs once work started', () => {
    expect(tabsInUse({ ...blank, techs: 1 })).toEqual(['details']);
    expect(tabsInUse({ ...blank, saved: true, techs: 1, status: 'Open' })).toEqual(['details', 'chat']);
    expect(tabsInUse({ ...blank, saved: true, status: 'Open', checkedIn: true })).toEqual(['details', 'timelog']);
  });
});
