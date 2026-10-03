// Prints the run's headline and writes metrics.md next to it.
//   node evals/support-triage/summarize.mjs [.claude/hillclimb/support-triage] [baseline]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarize } from './grade.mjs';

const flow = process.argv[2] ?? '.claude/hillclimb/support-triage';
const variant = process.argv[3] ?? 'baseline';
const dir = join(flow, variant);
const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const rows = read('results.jsonl');
const errors = read('errors.jsonl');
// A later success supersedes a failed attempt at the same (case, rep).
const scored = new Set(rows.map((r) => `${r.prompt_id}\0${r.rep}`));
const openErrors = errors.filter((e) => !scored.has(`${e.prompt_id}\0${e.rep}`)).length;
if (!rows.length) { console.error(`no results in ${dir}`); process.exit(1); }
const { text } = summarize(rows, { errors: openErrors });
const md = `# Support bot eval - ${variant}\n\n${text}\n`;
writeFileSync(join(dir, 'metrics.md'), md);
console.log(md);
