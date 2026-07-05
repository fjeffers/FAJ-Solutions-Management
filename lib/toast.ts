// Tiny app-wide toast bus — no dependencies, no context provider needed.
// Call toastError/toastSuccess from anywhere; <Toaster /> (components/Toaster.tsx)
// subscribes and renders the stack.

export type ToastKind = 'error' | 'success' | 'info';
export type ToastItem = { id: number; kind: ToastKind; message: string };

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(toasts);
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => { listeners.delete(listener); };
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string, durationMs: number) {
  // Collapse exact duplicates (e.g. several failed queries with the same message)
  if (toasts.some((t) => t.kind === kind && t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), durationMs);
}

export function toastError(message: string)   { push('error', message, 8000); }
export function toastSuccess(message: string) { push('success', message, 3500); }
export function toastInfo(message: string)    { push('info', message, 5000); }
