import { describe, expect, it } from 'vitest';
import { askFaj, techsNamed, type AskJob } from './ask-faj';

const job = (o: Partial<AskJob>): AskJob => ({ id: 'w1', wo_number: '191', title: 'Refresh', contractor_name: 'Paul Gibbs', remaining: 400, ...o });
const jobs = [job({}), job({ id: 'w2', wo_number: '205', contractor_name: 'Ana Ruiz', remaining: 150 }), job({ id: 'w3', wo_number: '210', remaining: 0 })];
const techs = ['Paul Gibbs', 'Ana Ruiz'];

describe('askFaj', () => {
  it('pays the tech on a job, filled in with what is owed', () => {
    expect(askFaj('pay Paul for 191', jobs, techs)).toEqual([{ kind: 'pay', woId: 'w1', label: 'Pay Paul Gibbs $400.00 for WO 191' }]);
    expect(askFaj('pay ana', jobs, techs)[0]).toMatchObject({ kind: 'pay', woId: 'w2' });
    expect(askFaj('pay 210', jobs, techs)[0]).toMatchObject({ kind: 'answer', text: 'WO 210 is paid in full.' });
    expect(askFaj('pay', jobs, techs)[0]).toMatchObject({ kind: 'view', view: 'payables' });
  });

  it('says what is owed, exactly', () => {
    expect(askFaj('what do I owe', jobs, techs)[0]).toMatchObject({ kind: 'answer', text: 'You owe your techs $550.00 on 2 jobs.' });
    expect(askFaj('what do i owe paul', jobs, techs)[0]).toMatchObject({ text: 'You owe Paul Gibbs $400.00 on 1 job.' });
  });

  it('opens a job, a new work order, or a screen', () => {
    expect(askFaj('191', jobs, techs)[0]).toMatchObject({ kind: 'open', woId: 'w1' });
    expect(askFaj('new job', jobs, techs)).toEqual([{ kind: 'new-job', label: 'Start a new work order' }]);
    expect(askFaj("who's late", jobs, techs)[0]).toMatchObject({ kind: 'view', view: 'workorders' });
    expect(askFaj('messages', jobs, techs)[0]).toMatchObject({ kind: 'view', view: 'messages' });
    expect(askFaj('xy', jobs, techs)).toEqual([]);
  });

  it('matches a tech by full name, or a first name', () => {
    expect(techsNamed('pay paul gibbs', techs)).toEqual(['Paul Gibbs']);
    expect(techsNamed('pay paula', techs)).toEqual([]);
  });
});
