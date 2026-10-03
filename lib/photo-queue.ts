// Job photos taken with no signal wait here, on the phone, until they can be
// sent (the same promise as the outbox in lib/wf-outbox.ts, but photos are too
// big for localStorage, so they go in the phone's IndexedDB). Each photo keeps
// the login it belongs to, so a shared phone never sends one tech's photo as
// another's. Browser only.

export type QueuedPhoto = {
  id: string;
  uid: string;
  woNumber: string;
  blob: Blob;
  takenAt: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  source: 'camera' | 'library';
};

const DB = 'faj-tech';
const STORE = 'photos';

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE, { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return open().then((db) => new Promise((resolve) => {
    if (!db) { resolve(null); return; }
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export async function queuePhoto(p: QueuedPhoto): Promise<boolean> {
  return (await run('readwrite', (s) => s.put(p))) !== null;
}

export async function queuedPhotos(uid: string, woNumber?: string): Promise<QueuedPhoto[]> {
  const all = (await run<QueuedPhoto[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedPhoto[]>)) ?? [];
  return all.filter((p) => p.uid === uid && (!woNumber || p.woNumber === woNumber))
    .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

export async function dropQueuedPhoto(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}
