// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import HoursTabs, { isHoursView } from './HoursTabs';

afterEach(cleanup);

describe('HoursTabs', () => {
  it('puts hours by day, by job, projects and site visits side by side', () => {
    const onGo = vi.fn();
    render(<HoursTabs view="hours" onGo={onGo} />);
    expect(screen.getByRole('tab', { name: 'By day' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'By job (WO #)' }));
    expect(onGo).toHaveBeenCalledWith('fieldsheet');
    expect(isHoursView('sitelog')).toBe(true);
    expect(isHoursView('invoices')).toBe(false);
  });
});
