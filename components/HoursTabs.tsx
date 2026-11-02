'use client';
// One place for hours and miles (Fred, 2026-10-31): Hours, the Field Sheet,
// Projects and the Site Log are tabs of one screen, the way the money screens
// are tabs of the Financials dashboard.

export const HOURS_TABS = [
  { view: 'hours', label: 'By day' },
  { view: 'fieldsheet', label: 'By job (WO #)' },
  { view: 'projects', label: 'Projects' },
  { view: 'sitelog', label: 'Site visits' },
] as const;

export const isHoursView = (v: string) => HOURS_TABS.some((t) => t.view === v);

export default function HoursTabs({ view, onGo }: { view: string; onGo: (v: string) => void }) {
  return (
    <div style={{ padding: '16px 16px 0' }}>
      <div style={{ fontSize: 12, color: '#8a8578', marginBottom: 6 }}>Hours, miles and receipts — all in one place</div>
      <div role="tablist" aria-label="Hours and miles" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #E4DFD3', paddingBottom: 8 }}>
        {HOURS_TABS.map((t) => (
          <button key={t.view} type="button" role="tab" aria-selected={view === t.view} onClick={() => onGo(t.view)}
            className={`btn ${view === t.view ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '7px 14px', fontSize: 13 }}>
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
