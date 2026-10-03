// Scoring for the support-bot eval: one email at a time (gradeCase) and the
// whole run (summarize). Plain functions, no API calls, so selfcheck.mjs can
// prove them on a perfect answer sheet and on lazy answers before any money is
// spent.

export const QUEUES = ['dispatch', 'field_issue', 'billing', 'new_work', 'needs_fred', 'not_a_ticket'];
export const QUEUE_LABEL = {
  dispatch: 'Dispatch', field_issue: 'Field issue', billing: 'Billing',
  new_work: 'New work', needs_fred: 'Needs Fred', not_a_ticket: 'Not a ticket',
};

// Claude Opus 5.5 first-party prices, $ per million tokens (SKILL.md, Oct 2026).
export const PRICES = { 'claude-opus-5-5': { in: 4, out: 20 } };

/** One email: right queue? right urgent? did the AI decline? */
export function gradeCase(input, run) {
  const got = run.result ?? {};
  const want = input.expected;
  return {
    grade: {
      queue_correct: got.queue === want.queue ? 1 : 0,
      urgent_correct: got.urgent === want.urgent ? 1 : 0,
      declined: run.error === 'refusal' ? 1 : 0,
    },
    explanation: {
      queue_correct: `bot: ${got.queue}, Fred: ${want.queue}. ${got.reason ?? ''}`.trim(),
      urgent_correct: `bot: ${got.urgent ? 'urgent' : 'not urgent'}, Fred: ${want.urgent ? 'urgent' : 'not urgent'}`,
    },
  };
}

/** Dollars for one row, from the tokens the API reported and the model that answered. */
export function costOf(row) {
  const p = PRICES[row.model];
  const u = row.usage;
  if (!p || !u) return null;
  const inTok = (u.input_tokens ?? 0) + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return (inTok * p.in + (u.output_tokens ?? 0) * p.out) / 1e6;
}

/** Wilson 95% interval for a pass rate. */
function wilson(k, n) {
  if (!n) return [0, 0];
  const z = 1.96, p = k / n, d = 1 + z * z / n;
  const c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const pct = (x) => `${Math.round(x * 100)}%`;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };

/**
 * The whole run: headline with a 95% interval, per-queue precision and recall,
 * the mix-ups table, urgent precision/recall, declines, cost and time.
 * Only status-ok rows are scored. Returns { text (markdown), numbers }.
 */
export function summarize(rows, { errors = 0 } = {}) {
  const ok = rows.filter((r) => r.status === 'ok');
  const n = ok.length;
  const k = ok.reduce((s, r) => s + r.grade.queue_correct, 0);
  const ku = ok.reduce((s, r) => s + r.grade.urgent_correct, 0);
  const declined = ok.reduce((s, r) => s + (r.grade.declined ?? 0), 0);
  const [lo, hi] = wilson(k, n);

  // Mix-ups: Fred's queue down the side, the bot's across the top.
  const m = Object.fromEntries(QUEUES.map((a) => [a, Object.fromEntries(QUEUES.map((b) => [b, 0]))]));
  for (const r of ok) if (m[r.meta?.expected_queue] && r.predicted_queue in m) m[r.meta.expected_queue][r.predicted_queue]++;
  const perQueue = QUEUES.map((q) => {
    const tp = m[q][q];
    const fredSays = QUEUES.reduce((s, b) => s + m[q][b], 0);
    const botSays = QUEUES.reduce((s, a) => s + m[a][q], 0);
    return { q, fredSays, botSays, recall: fredSays ? tp / fredSays : null, precision: botSays ? tp / botSays : null };
  });

  const urgentTP = ok.filter((r) => r.meta?.expected_urgent && r.predicted_urgent).length;
  const urgentFred = ok.filter((r) => r.meta?.expected_urgent).length;
  const urgentBot = ok.filter((r) => r.predicted_urgent).length;

  const costs = ok.map(costOf).filter((c) => c != null);
  const lat = ok.map((r) => r.latency_s).filter((x) => typeof x === 'number');
  const missed = ok.filter((r) => !r.grade.queue_correct);

  const lines = [];
  lines.push(`**Right queue: ${pct(n ? k / n : 0)}** (${k} of ${n} sorts; 95% range ${pct(lo)}-${pct(hi)})`);
  lines.push(`Right urgent flag: ${pct(n ? ku / n : 0)} (${ku} of ${n}). Urgent caught: ${urgentTP} of ${urgentFred}; flagged urgent wrongly: ${urgentBot - urgentTP}.`);
  lines.push(`AI declined: ${declined}. Cut off: ${rows.length - n}. Failed to run: ${errors}.`);
  if (costs.length) lines.push(`Cost: $${(costs.reduce((a, b) => a + b, 0)).toFixed(2)} for the run, $${median(costs).toFixed(4)} per email (median).`);
  if (lat.length) lines.push(`Time: ${median(lat).toFixed(1)} s per email (median), ${Math.max(...lat).toFixed(1)} s slowest.`);
  lines.push('', '| Queue | Fred | Bot | Found (recall) | Right when it says so (precision) |', '|---|---|---|---|---|');
  for (const p of perQueue) lines.push(`| ${QUEUE_LABEL[p.q]} | ${p.fredSays} | ${p.botSays} | ${p.recall == null ? '-' : pct(p.recall)} | ${p.precision == null ? '-' : pct(p.precision)} |`);
  lines.push('', '**Mix-ups** (rows: Fred\'s queue, columns: what the bot said)', '',
    `| Fred \\ Bot | ${QUEUES.map((q) => QUEUE_LABEL[q]).join(' | ')} |`, `|---|${QUEUES.map(() => '---').join('|')}|`);
  for (const a of QUEUES) lines.push(`| ${QUEUE_LABEL[a]} | ${QUEUES.map((b) => (m[a][b] ? (a === b ? `**${m[a][b]}**` : String(m[a][b])) : '')).join(' | ')} |`);
  if (missed.length) {
    lines.push('', '**Wrong queue**', '');
    for (const r of missed) lines.push(`- ${r.prompt_id} (rep ${r.rep}): bot ${QUEUE_LABEL[r.predicted_queue] ?? r.predicted_queue}, Fred ${QUEUE_LABEL[r.meta?.expected_queue]}`);
  }
  return { text: lines.join('\n'), numbers: { n, queue_rate: n ? k / n : 0, ci: [lo, hi], urgent_rate: n ? ku / n : 0, declined, perQueue, matrix: m } };
}
