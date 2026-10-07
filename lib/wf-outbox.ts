// No-signal mode for the tech portal (Fred, 2026-10-02: "working without
// signal"). A port of WorkFlow's SyncService.
//
// A tap that cannot reach the office — clock in/out, a checklist tick, an
// answer to an offer, "work done", a crew punch — is kept on the phone and sent
// as soon as there is signal: oldest first, each with the time it was really
// tapped (the wf_*_at server functions record that time, trusting it up to 48
// hours back). Something the office refuses (the job was closed meanwhile, say)
// is dropped and reported, never retried forever.
//
// Each login keeps its own queue and saved lists, so a shared phone never shows
// one tech another's work.

export type PendingAction = {
  id: string;
  kind: string;
  args: Record<string, unknown>;
  /** What to call it if it has to be reported ("Clock in on WO 1234"). */
  label: string;
  /** When it was tapped (ISO). */
  at: string;
};

export type ActionOutcome =
  | { status: 'sent' }
  | { status: 'queued' }
  | { status: 'refused'; error: string };

/** Sends one action. Throws on failure: a RefusedError when the office said no. */
export type ActionHandler = (args: Record<string, unknown>, at: Date) => Promise<void>;

/** The office answered, and the answer was no. Never retried. */
export class RefusedError extends Error {}

/** Was this failure "no signal" (keep it and retry) rather than a refusal? */
export function isNoSignal(e: unknown): boolean {
  if (e instanceof RefusedError) return false;
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '');
  if (/failed to fetch|networkerror|network request failed|load failed|fetch failed|network error|xmlhttprequest error|timed? ?out|econnreset|enotfound|err_internet_disconnected/i.test(msg)) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Plain words for what happened to a tap. */
export function outcomeMessage(o: ActionOutcome, sent?: string): string | null {
  if (o.status === 'refused') return o.error;
  if (o.status === 'queued') return 'No signal — saved on this phone. It sends as soon as you have signal.';
  return sent ?? null;
}

/** The bit of localStorage this needs, so tests can hand in a plain object. */
export type KeyValue = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** The browser's localStorage, or null where there is none (or it is blocked). */
export function browserStorage(): KeyValue | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const probe = '__faj_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

const OUTBOX = (uid: string) => `faj-tech-outbox:${uid}`;
const CACHE = (uid: string, name: string) => `faj-tech-cache:${uid}:${name}`;
const LAST_UID = 'faj-tech-last-uid';

/** Keep a copy of a list on the phone, for opening with no signal. */
export function saveCopy(kv: KeyValue | null, uid: string, name: string, value: unknown): void {
  if (!kv || !uid) return;
  try {
    kv.setItem(CACHE(uid, name), JSON.stringify({ at: new Date().toISOString(), value }));
    kv.setItem(LAST_UID, uid);
  } catch { /* storage full or blocked: the live copy still works */ }
}

/** The saved copy and when it was saved, or null. */
export function loadCopy<T>(kv: KeyValue | null, uid: string, name: string): { at: string; value: T } | null {
  if (!kv || !uid) return null;
  try {
    const raw = kv.getItem(CACHE(uid, name));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: string; value?: T };
    return parsed && parsed.value !== undefined ? { at: parsed.at ?? '', value: parsed.value } : null;
  } catch {
    return null;
  }
}

/** Who last used the portal on this phone — for opening with no signal. */
export function lastUid(kv: KeyValue | null): string | null {
  try { return kv?.getItem(LAST_UID) ?? null; } catch { return null; }
}

/** Forget everything saved for a login (on sign-out). */
export function clearCopies(kv: KeyValue | null, uid: string, names: string[]): void {
  if (!kv || !uid) return;
  try {
    for (const n of names) kv.removeItem(CACHE(uid, n));
    if (kv.getItem(LAST_UID) === uid) kv.removeItem(LAST_UID);
  } catch { /* nothing to clear */ }
}

let seq = 0;
const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function makeAction(kind: string, args: Record<string, unknown>, label: string, at: Date = new Date()): PendingAction {
  return { id: newId(), kind, args, label, at: at.toISOString() };
}

/**
 * The outbox. One per signed-in tech.
 *
 * `run` sends now, or keeps the tap when there is no signal. A tap made while
 * older ones are still waiting queues behind them — it never jumps the line.
 */
export class Outbox {
  private handlers = new Map<string, ActionHandler>();
  private listeners = new Set<() => void>();
  private inFlight: Promise<number> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  pending: PendingAction[] = [];
  problems: string[] = [];
  offline = false;
  lastSent: Date | null = null;

  constructor(private kv: KeyValue | null, readonly uid: string, private retryMs = 20_000) {
    this.pending = this.read();
  }

  register(kind: string, handler: ActionHandler): void {
    this.handlers.set(kind, handler);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }

  private read(): PendingAction[] {
    if (!this.kv) return [];
    try {
      const raw = this.kv.getItem(OUTBOX(this.uid));
      const list = raw ? (JSON.parse(raw) as PendingAction[]) : [];
      return Array.isArray(list) ? list.filter((a) => a && a.id && a.kind) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    if (!this.kv) return;
    try {
      if (this.pending.length === 0) this.kv.removeItem(OUTBOX(this.uid));
      else this.kv.setItem(OUTBOX(this.uid), JSON.stringify(this.pending));
    } catch { /* storage full: the tap stays in memory until sent */ }
  }

  /** Mark that a read just failed for lack of signal (or worked). */
  noteSignal(ok: boolean): void {
    if (this.offline === !ok) return;
    this.offline = !ok;
    this.changed();
    this.schedule();
  }

  clearProblems(): void {
    this.problems = [];
    this.changed();
  }

  async run(action: PendingAction): Promise<ActionOutcome> {
    if (this.pending.length > 0) {
      this.queue(action);
      void this.flush();
      return { status: 'queued' };
    }
    try {
      await this.send(action);
      this.lastSent = new Date();
      this.noteSignal(true);
      return { status: 'sent' };
    } catch (e) {
      if (isNoSignal(e)) {
        this.queue(action);
        this.noteSignal(false);
        return { status: 'queued' };
      }
      return { status: 'refused', error: e instanceof Error ? e.message : "That didn't go through." };
    }
  }

  private queue(a: PendingAction): void {
    this.pending = [...this.pending, a];
    this.write();
    this.changed();
    this.schedule();
  }

  /**
   * Send everything waiting, oldest first; stop at the first sign of no signal.
   * Returns how many went through. If a send is already running (the retry
   * timer, say), this waits for it and runs again, so "Send now" is never lost.
   */
  async flush(): Promise<number> {
    while (this.inFlight) await this.inFlight;
    const run = this.flushOnce();
    this.inFlight = run;
    try {
      return await run;
    } finally {
      this.inFlight = null;
    }
  }

  private async flushOnce(): Promise<number> {
    let sent = 0;
    try {
      for (const a of [...this.pending]) {
        try {
          await this.send(a);
          sent++;
          this.pending = this.pending.filter((p) => p.id !== a.id);
          this.write();
        } catch (e) {
          if (isNoSignal(e)) {
            this.noteSignal(false);
            break;
          }
          this.pending = this.pending.filter((p) => p.id !== a.id);
          this.write();
          this.problems = [...this.problems, `${a.label}: ${e instanceof Error ? e.message : 'not accepted'}`];
        }
      }
      if (sent > 0) {
        this.lastSent = new Date();
        this.offline = false;
        this.onFlushed?.(sent);
      }
    } finally {
      this.changed();
      this.schedule();
    }
    return sent;
  }

  private async send(a: PendingAction): Promise<void> {
    const handler = this.handlers.get(a.kind);
    if (!handler) throw new RefusedError(`This version of the portal cannot send "${a.label}".`);
    await handler(a.args, new Date(a.at));
  }

  /** While anything waits, or the last read failed, try again every 20 seconds. */
  private schedule(): void {
    const want = this.pending.length > 0 || this.offline;
    if (want && !this.timer) {
      this.timer = setInterval(() => { void this.tick(); }, this.retryMs);
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Set by the page: called after waiting taps went out, to reload the lists. */
  onFlushed: ((sent: number) => void) | null = null;

  /** Set by the page: a cheap call that tells whether the signal is back. */
  probe: (() => Promise<void>) | null = null;

  private async tick(): Promise<void> {
    if (this.pending.length > 0) {
      await this.flush();
      return;
    }
    if (!this.probe) return;
    try {
      await this.probe();
      this.noteSignal(true);
    } catch (e) {
      if (!isNoSignal(e)) this.noteSignal(true);
    }
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
