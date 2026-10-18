// Field Service LIVE's building blocks for the FAJ tech portal (Fred,
// 2026-10-17: "add Field Service's tech portal to FAJ Tech Portal" — the app
// in github.com/fjeffers/FieldService.app, app/components/workspace.js).
// Styles live in app/tech/fs.css under fs- names.
import type { ReactNode } from 'react';

const PATHS: Record<string, string> = {
  menu: 'M4 7h16 M4 12h16 M4 17h16',
  close: 'M6 6l12 12 M6 18 18 6',
  projects: 'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z',
  sheet: 'M4 4.5h16v15H4z M4 9.5h16 M4 14.5h16 M9.5 9.5v10',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.2a6.5 6.5 0 0 1 3.5 5.8',
  person: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4.5 21a7.5 7.5 0 0 1 15 0',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3.5v4 M16 3.5v4 M8 14h2 M14 14h2 M8 17h2',
  clipboard: 'M9 4.5h6v3H9z M7.5 6H5.5v14.5h13V6h-2 M8.5 12h7 M8.5 16h5',
  bell: 'M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z M10 20.5a2 2 0 0 0 4 0',
  logout: 'M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10 M15 8l4 4-4 4 M19 12H9',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7v5l3 2',
  message: 'M4 5h16v11H9l-5 4z',
  chat: 'M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z M8 9.5h8 M8 12.5h5',
  money: 'M12 3v18 M16.5 7.5C16.5 5.8 14.5 4.5 12 4.5S7.5 5.8 7.5 7.5s2 2.6 4.5 3 4.5 1.3 4.5 3-2 3-4.5 3-4.5-1.3-4.5-3',
  inbox: 'M4 13l2.5-8h11L20 13v6H4z M4 13h5l1 2h4l1-2h5',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4.5H15',
  file: 'M7 3h7l5 5v13H7z M14 3v5h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4z M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2z M9 8h6 M9 12h6',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.5',
  travel: 'M3 7h11v9H3z M14 10h4l3 3v3h-7 M7 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M17 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
};

export function FsIcon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d={PATHS[name] ?? PATHS.file} />
    </svg>
  );
}

export function FsBrand() {
  return (
    <span className="fs-brand" aria-label="Field Service LIVE">
      <span className="fs-brand-mark" aria-hidden="true">
        <svg viewBox="0 0 28 28" width="28" height="28">
          <path d="M6.5 5.5h11M6.5 5.5v17M6.5 13.5h8" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="square" />
          <path d="M15.5 20l3 3 5.5-6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="fs-brand-text"><b>fieldservice</b><small>LIVE</small></span>
    </span>
  );
}

export function FsPageHeader({ eyebrow = 'FIELD WORKSPACE', title, subtitle, children }: {
  eyebrow?: string; title: string; subtitle?: string; children?: ReactNode;
}) {
  return (
    <div className="fs-page-head">
      <div>
        <p className="fs-eyebrow"><i />{eyebrow}</p>
        <h1>{title}</h1>
        {subtitle && <p className="fs-subtitle">{subtitle}</p>}
      </div>
      {children && <div className="fs-page-head-side">{children}</div>}
    </div>
  );
}

export function FsChip({ tone = 'green', dot, children }: { tone?: 'green' | 'amber' | 'red' | 'grey'; dot?: boolean; children: ReactNode }) {
  return <span className={`fs-chip fs-chip-${tone}`}>{dot && <i />}{children}</span>;
}

export const fsInitials = (name = '') =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
