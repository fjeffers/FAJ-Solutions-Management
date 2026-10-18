// @vitest-environment jsdom
//
// The Field Service work order pieces as a tech sees them: the tabs, the one
// next step for each stage and the FAJ day tap each button sends, and the day's
// time and travel.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FsDayLog, FsStageAction, FsWorkSections, FS_SECTIONS, type FsSection } from './FsWork';
import type { DayActions } from './ProjectDay';
import type { DayEvent } from '@/lib/project-day';
import { useState } from 'react';

afterEach(cleanup);

const actions = (): DayActions => ({
  clockIn: vi.fn(), startTrip: vi.fn(), startJob: vi.fn(), lunch: vi.fn(), offSite: vi.fn(), arrived: vi.fn(),
});
const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

function Tabs({ onPanel }: { onPanel: (s: FsSection) => void }) {
  const [active, setActive] = useState<FsSection>('overview');
  const panels = Object.fromEntries(FS_SECTIONS.map(([id, label]) => {
    if (id === active) onPanel(id);
    return [id, <p key={id}>{label} panel</p>];
  })) as Record<FsSection, React.ReactNode>;
  return <FsWorkSections active={active} onChange={setActive} panels={panels} />;
}

describe('FsWorkSections', () => {
  it('shows one tab at a time and moves with the arrow keys', async () => {
    const shown: FsSection[] = [];
    render(<Tabs onPanel={(s) => shown.push(s)} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(FS_SECTIONS.map(([, l]) => l));
    expect(screen.getByText('Overview panel')).toBeTruthy();
    expect(screen.queryByText('Messages panel')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(screen.getByText('Messages panel')).toBeTruthy();
    expect(screen.queryByText('Overview panel')).toBeNull();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Overview' }));
    await userEvent.keyboard('{End}');
    expect(screen.getByText('Messages panel')).toBeTruthy();
    // A closed tab is not rendered, so it can't load anything or mark messages read.
    expect(shown.every((s) => s === 'overview' || s === 'messages')).toBe(true);
  });
});

describe('FsStageAction', () => {
  it('clocks in, then starts travel to the site', async () => {
    const on = actions();
    const { rerender } = render(<FsStageAction stage="ready" events={[]} busy={false} enabled on={on} />);
    await userEvent.click(screen.getByRole('button', { name: /Clock in/ }));
    expect(on.clockIn).toHaveBeenCalledOnce();
    rerender(<FsStageAction stage="clocked" events={[{ kind: 'day_start', at: iso(5) }]} busy={false} enabled on={on} />);
    expect(screen.getByText('Clocked in')).toBeTruthy();
    // The first drive on the job asks where they're leaving from.
    expect(screen.getByRole('combobox', { name: 'Leaving from' })).toHaveProperty('value', 'home');
    await userEvent.click(screen.getByRole('button', { name: /Start travel to site/ }));
    expect(on.startTrip).toHaveBeenCalledWith('site', 'home');
    await userEvent.click(screen.getByRole('button', { name: 'Already on site? Confirm arrival' }));
    expect(on.startJob).toHaveBeenCalledOnce();
  });

  it('confirms arrival: Start job at the site, Arrived at the next site', async () => {
    const on = actions();
    const toSite: DayEvent[] = [{ kind: 'day_start', at: iso(40) }, { kind: 'travel_start', at: iso(30), dest: 'site' }];
    const { rerender } = render(<FsStageAction stage="outbound" events={toSite} busy={false} enabled on={on} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm arrival' }));
    expect(on.startJob).toHaveBeenCalledOnce();
    const toNext: DayEvent[] = [...toSite.slice(0, 1), { kind: 'travel_start', at: iso(30), dest: 'next_site' }];
    rerender(<FsStageAction stage="outbound" events={toNext} busy={false} enabled on={on} />);
    expect(screen.getByText('Arrive at the next site')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm arrival' }));
    expect(on.arrived).toHaveBeenCalledOnce();
  });

  it('on site: lunch and off site; off site: travel to the hotel by default', async () => {
    const on = actions();
    const onSite: DayEvent[] = [{ kind: 'day_start', at: iso(120) }, { kind: 'in', at: iso(90) }];
    const { rerender } = render(<FsStageAction stage="onsite" events={onSite} busy={false} enabled on={on} />);
    expect(screen.getByText(/On site 1h 30m/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Start lunch' }));
    expect(on.lunch).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Off site' }));
    expect(on.offSite).toHaveBeenCalledOnce();
    rerender(<FsStageAction stage="offsite" events={[...onSite, { kind: 'out', at: iso(1) }]} busy={false} enabled={false} on={on} />);
    // After Work done the tech can still drive home.
    const form = screen.getByRole('heading', { name: 'Where to now?' }).closest('form')!;
    expect(within(form).getByRole('combobox')).toHaveProperty('value', 'hotel');
    // Leaving the site, the drive starts from the site: no need to ask.
    expect(within(form).queryByRole('combobox', { name: 'Leaving from' })).toBeNull();
    await userEvent.click(within(form).getByRole('button', { name: /Start travel/ }));
    expect(on.startTrip).toHaveBeenCalledWith('hotel', undefined);
  });

  it('a trip away: home to the hotel, signed out there, then clock in again for the site', async () => {
    const on = actions();
    const { rerender } = render(<FsStageAction stage="clocked" events={[{ kind: 'day_start', at: iso(300) }]} busy={false} enabled on={on} onReceipt={vi.fn()} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Travel to' }), 'hotel');
    await userEvent.click(screen.getByRole('button', { name: /Start travel/ }));
    expect(on.startTrip).toHaveBeenCalledWith('hotel', 'home');
    const driving: DayEvent[] = [{ kind: 'day_start', at: iso(300) }, { kind: 'travel_start', at: iso(290), origin: 'home', dest: 'hotel' }];
    rerender(<FsStageAction stage="outbound" events={driving} busy={false} enabled on={on} />);
    expect(screen.getByText('Arrive at the hotel')).toBeTruthy();
    expect(screen.getByText(/This signs you out for the day/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm arrival' }));
    expect(on.arrived).toHaveBeenCalledOnce();
    rerender(<FsStageAction stage="done" events={[...driving, { kind: 'travel_end', at: iso(60), miles: 210 }]} busy={false} enabled on={on} />);
    await userEvent.click(screen.getByRole('button', { name: /Clock in again/ }));
    expect(on.clockIn).toHaveBeenCalledOnce();
  });

  it('offers a receipt on the road, not while on site', async () => {
    const onReceipt = vi.fn();
    const { rerender } = render(<FsStageAction stage="clocked" events={[]} busy={false} enabled on={actions()} onReceipt={onReceipt} />);
    await userEvent.click(screen.getByRole('button', { name: /Add a receipt/ }));
    expect(onReceipt).toHaveBeenCalledOnce();
    rerender(<FsStageAction stage="onsite" events={[]} busy={false} enabled on={actions()} onReceipt={onReceipt} />);
    expect(screen.queryByRole('button', { name: /Add a receipt/ })).toBeNull();
  });

  it('back from lunch, confirm return, and stopped work', async () => {
    const on = actions();
    const { rerender } = render(<FsStageAction stage="lunch" events={[]} busy={false} enabled on={on} />);
    await userEvent.click(screen.getByRole('button', { name: 'Back from lunch' }));
    expect(on.lunch).toHaveBeenCalledWith(false);
    const home: DayEvent[] = [{ kind: 'day_start', at: iso(60) }, { kind: 'travel_start', at: iso(30), origin: 'hotel', dest: 'home' }];
    rerender(<FsStageAction stage="returning" events={home} busy={false} enabled on={on} />);
    expect(screen.getByText('Arrive home')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Confirm arrival' }));
    expect(on.arrived).toHaveBeenCalledOnce();
    rerender(<FsStageAction stage="stopped" events={[]} busy={false} enabled on={on} />);
    expect(screen.getAllByText('Work stopped').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('holds the buttons while the location is being read', () => {
    render(<FsStageAction stage="ready" events={[]} busy enabled on={actions()} />);
    expect(screen.getByRole('button', { name: /Clock in/ })).toHaveProperty('disabled', true);
    expect(screen.getByText('Getting your location…')).toBeTruthy();
  });
});

describe('FsDayLog', () => {
  it('lists the clock in, the drive and the time on site', () => {
    render(<FsDayLog events={[
      { kind: 'day_start', at: iso(200) },
      { kind: 'travel_start', at: iso(190), origin: 'hotel', dest: 'site' },
      { kind: 'travel_end', at: iso(160), miles: 12.5 },
      { kind: 'in', at: iso(160) },
      { kind: 'out', at: iso(40) },
    ]} />);
    expect(screen.getByText('Clocked in')).toBeTruthy();
    expect(screen.getByText('Hotel → Site')).toBeTruthy();
    expect(within(screen.getByText('Hotel → Site').parentElement!).getByText(/ · 30m · 12.5 mi$/)).toBeTruthy();
    expect(within(screen.getByText('On site').parentElement!).getByText(/ · 2h 00m$/)).toBeTruthy();
    expect(screen.getByText(/^On site 2h 00m · travel 30m · 12.5 mi/)).toBeTruthy();
  });

  it('says so when nothing is recorded yet', () => {
    render(<FsDayLog events={[]} />);
    expect(screen.getByText(/Nothing recorded yet/)).toBeTruthy();
  });
});
