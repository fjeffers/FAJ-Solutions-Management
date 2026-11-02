'use client';
// The tech picked on Hours (By day) and the Field Sheet (By job) stays picked
// while Fred moves between jobs and tabs (Fred, 2026-11-02: "i want to stay only
// with that tech hours until i'm finish"). Kept for this browser tab until he
// picks All techs again.
import { useCallback, useState } from 'react';

export const TECH_PICK_KEY = 'faj-hours-tech';

export function readTechPick(): string {
  try { return (typeof window !== 'undefined' && window.sessionStorage.getItem(TECH_PICK_KEY)) || ''; } catch { return ''; }
}

export function useTechPick(): [string, (tech: string) => void] {
  const [tech, setState] = useState(readTechPick);
  const set = useCallback((t: string) => {
    setState(t);
    try {
      if (t) window.sessionStorage.setItem(TECH_PICK_KEY, t); else window.sessionStorage.removeItem(TECH_PICK_KEY);
    } catch { /* private window */ }
  }, []);
  return [tech, set];
}

/** The picked tech, when this job has them; otherwise everyone shows. */
export const techShown = (pick: string, techs: string[]) => (pick && techs.includes(pick) ? pick : '');

/** The picked tech first, so Add a day starts on them. */
export const pickFirst = (pick: string, techs: string[]) => (pick && techs.includes(pick) ? [pick, ...techs.filter((t) => t !== pick)] : techs);
