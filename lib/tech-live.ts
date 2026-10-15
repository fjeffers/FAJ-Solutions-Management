// Live updates in the tech app (Fred, 2026-10-14: "implement live update
// between admin and tech portal"). The app re-reads the tech's jobs every
// little while; this works out what changed since the last read and says it
// in a line a tech can act on. Wording stays about the job, never who changed
// it (see tech-portal-accounts).
import { fmtClock12, parseClockTime, requestWhen, type WfJob } from './wf';

export type JobChange = { number: string; text: string };

const clock = (raw: string) => {
  const t = parseClockTime(raw);
  return t ? fmtClock12(t) : '';
};

function timeText(j: WfJob): string {
  const a = clock(j.startTime);
  const b = clock(j.endTime);
  return a && b ? `${a} – ${b}` : a || b || 'no set time';
}

/** Offered or turned down jobs aren't the tech's work yet; changes there stay quiet. */
const watched = (j: WfJob) => j.status !== 'declined';

/**
 * What changed between two reads of the tech's jobs.
 * `files` maps a job number to how many office documents it has (wf_tech_files_stamp).
 */
export function jobChanges(
  prev: WfJob[], next: WfJob[],
  prevFiles: Record<string, number> = {}, nextFiles: Record<string, number> = {},
): JobChange[] {
  const before = new Map(prev.map((j) => [j.number, j]));
  const out: JobChange[] = [];
  for (const j of next) {
    if (!watched(j)) continue;
    const o = before.get(j.number);
    if (!o) {
      out.push({ number: j.number, text: `New job: WO ${j.number}${j.client || j.title ? ` · ${j.client || j.title}` : ''}` });
      continue;
    }
    const wo = `WO ${j.number}`;
    if (o.date !== j.date) {
      out.push({ number: j.number, text: j.date ? `${wo}: new date ${requestWhen({ date: j.date, time: j.startTime })}` : `${wo}: date taken off the schedule` });
    } else if (o.startTime !== j.startTime || o.endTime !== j.endTime) {
      out.push({ number: j.number, text: `${wo}: new time ${timeText(j)}` });
    }
    if (o.street !== j.street || o.city !== j.city) {
      out.push({ number: j.number, text: `${wo}: new address ${[j.street, j.city].filter(Boolean).join(', ')}` });
    }
    if (o.description !== j.description) out.push({ number: j.number, text: `${wo}: the scope of work was updated` });
    if (o.access !== j.access || o.special !== j.special) out.push({ number: j.number, text: `${wo}: site access notes were updated` });
    if (o.status !== 'closed' && j.status === 'closed') out.push({ number: j.number, text: `${wo} was closed` });
    const had = prevFiles[j.number] ?? 0;
    const has = nextFiles[j.number] ?? 0;
    if (has > had) out.push({ number: j.number, text: has - had === 1 ? `${wo}: a new document was added` : `${wo}: ${has - had} new documents were added` });
  }
  const now = new Set(next.map((j) => j.number));
  for (const o of prev) {
    if (!now.has(o.number) && watched(o) && o.status !== 'closed') out.push({ number: o.number, text: `WO ${o.number} is no longer on your list` });
  }
  return out;
}
