// Shims the browser bits the app touches that jsdom does not reliably provide.
// Only loaded for tests that ask for the jsdom environment.

if (typeof globalThis.window !== 'undefined') {
  const makeStorage = (): Storage => {
    let store = new Map<string, string>();
    return {
      get length() { return store.size; },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store = new Map(); },
    } as Storage;
  };

  // jsdom withholds storage on some origins, and versions differ on what it
  // hands back, so install our own whenever it is not a working Storage.
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const existing = (globalThis as unknown as Record<string, Storage | undefined>)[name];
    if (!existing || typeof existing.getItem !== 'function') {
      Object.defineProperty(globalThis, name, {
        value: makeStorage(), writable: true, configurable: true,
      });
    }
  }

  // Used by the check-in flow and the copy buttons.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() }, writable: true, configurable: true,
    });
  }
}
