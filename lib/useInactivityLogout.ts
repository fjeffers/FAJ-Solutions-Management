'use client';
import { useEffect, useRef, useCallback } from 'react';

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

export function useInactivityLogout(onLogout: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(onLogout, TIMEOUT_MS);
  }, [onLogout]);

  useEffect(() => {
    reset();
    EVENTS.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      EVENTS.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [reset]);
}
