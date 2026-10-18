// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FsBell } from './FsBell';
import { addNotes, markRead, messageNote, notesFromChanges } from '@/lib/tech-inbox';

afterEach(cleanup);

const at = new Date(Date.now() - 5 * 60_000).toISOString();
const notes = addNotes([], [
  ...notesFromChanges([
    { number: '24017', kind: 'time', text: 'WO 24017: new time 9:00 AM' },
    { number: '24021', kind: 'new', text: 'New job: WO 24021' },
  ], at),
  messageNote(2, at),
]);

describe('the bell', () => {
  it('shows the unread count, red when something is high priority', () => {
    render(<FsBell notes={notes} onOpen={vi.fn()} onReadAll={vi.fn()} />);
    const bell = screen.getByRole('button', { name: 'Notifications, 3 unread' });
    expect(bell.textContent).toContain('3');
    expect(bell.className).toContain('urgent');
  });

  it('lists every notification, filters them, and opens one', async () => {
    const onOpen = vi.fn();
    const onReadAll = vi.fn();
    render(<FsBell notes={markRead(notes, [notes[2].id])} onOpen={onOpen} onReadAll={onReadAll} />);
    await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(screen.getByRole('dialog', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByText('WO 24017: new time 9:00 AM')).toBeTruthy();
    expect(screen.getAllByText('5 min ago').length).toBe(3);
    await userEvent.click(screen.getByRole('button', { name: 'High priority' }));
    expect(screen.queryByText('New job: WO 24021')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Unread (2)' }));
    expect(screen.getByText('New job: WO 24021')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
    expect(onReadAll).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByText('New job: WO 24021'));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ number: '24021' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says what will show there when there is nothing yet', async () => {
    render(<FsBell notes={[]} onOpen={vi.fn()} onReadAll={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Notifications, 0 unread' }));
    expect(screen.getByText(/New jobs, changes to your jobs and new messages show here/)).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
