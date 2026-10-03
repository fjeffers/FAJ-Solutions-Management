// Proves the scoring before any money is spent (eval-audit: oracle + null).
//   node evals/support-triage/selfcheck.mjs
// A perfect answer sheet must score 100%; lazy answers must score what their
// share of the set predicts; a refusal must count as declined; cost must price.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gradeCase, summarize, costOf, QUEUES } from './grade.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cases = readFileSync(join(here, 'cases.jsonl'), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
let failed = 0;
const check = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`); if (!cond) failed++; };

function runAll(answer) {
  return cases.map((c) => {
    const input = { expected: c.expected };
    const run = answer(c);
    const g = gradeCase(input, run);
    return {
      prompt_id: c.prompt_id, rep: 0, status: 'ok', meta: { expected_queue: c.expected.queue, expected_urgent: c.expected.urgent },
      predicted_queue: run.result?.queue, predicted_urgent: run.result?.urgent, grade: g.grade,
      model: 'claude-opus-5-5', usage: { input_tokens: 1800, output_tokens: 400 }, latency_s: 6,
    };
  });
}

const share = (q) => cases.filter((c) => c.expected.queue === q).length / cases.length;
const notUrgentShare = cases.filter((c) => !c.expected.urgent).length / cases.length;

// Oracle: the answers themselves.
const oracle = summarize(runAll((c) => ({ result: { queue: c.expected.queue, urgent: c.expected.urgent } })));
check('perfect answers score 100% on queue', oracle.numbers.queue_rate === 1, `${oracle.numbers.queue_rate}`);
check('perfect answers score 100% on urgent', oracle.numbers.urgent_rate === 1);
check('perfect answers: every queue found and precise', oracle.numbers.perQueue.every((p) => p.recall === 1 && p.precision === 1));

// Null answers: always the same queue, never urgent.
for (const q of ['needs_fred', 'dispatch', 'not_a_ticket']) {
  const s = summarize(runAll(() => ({ result: { queue: q, urgent: false } })));
  check(`always "${q}" scores only its share`, Math.abs(s.numbers.queue_rate - share(q)) < 1e-9, `${Math.round(s.numbers.queue_rate * 100)}%`);
}
const never = summarize(runAll(() => ({ result: { queue: 'dispatch', urgent: false } })));
check('never-urgent scores only the not-urgent share', Math.abs(never.numbers.urgent_rate - notUrgentShare) < 1e-9, `${Math.round(never.numbers.urgent_rate * 100)}%`);

// Empty / unreadable answer is a miss, not a pass.
const empty = summarize(runAll(() => ({ result: {} })));
check('an empty answer scores 0% on queue', empty.numbers.queue_rate === 0);

// A refusal is counted as declined, and still scored (it lands in Needs Fred).
const refused = gradeCase({ expected: { queue: 'needs_fred', urgent: false } }, { result: { queue: 'needs_fred', urgent: false }, error: 'refusal' });
check('a refusal counts as declined', refused.grade.declined === 1);

// Cost: 1,800 in + 400 out on Opus 5.5 = $0.0152.
check('cost is priced from tokens', Math.abs(costOf({ model: 'claude-opus-5-5', usage: { input_tokens: 1800, output_tokens: 400 } }) - 0.0152) < 1e-9);
check('an unknown model is not priced as $0', costOf({ model: 'mystery', usage: { input_tokens: 1 } }) === null);

// The set covers every queue.
check('every queue has cases', QUEUES.every((q) => share(q) > 0), QUEUES.map((q) => `${q} ${Math.round(share(q) * cases.length)}`).join(', '));

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks pass.');
process.exit(failed ? 1 : 0);
