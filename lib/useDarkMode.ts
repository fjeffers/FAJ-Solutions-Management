'use client';
import { useState, useEffect } from 'react';

export function useDarkMode() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('faj-dark-mode');
    if (stored === 'true') { setDark(true); document.documentElement.classList.add('dark'); }
  }, []);

  const toggle = () => {
    setDark((d) => {
      const next = !d;
      document.documentElement.classList.toggle('dark', next);
      localStorage.setItem('faj-dark-mode', String(next));
      return next;
    });
  };

  return { dark, toggle };
}
