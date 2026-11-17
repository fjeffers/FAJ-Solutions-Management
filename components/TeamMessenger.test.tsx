// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import TeamMessenger from './TeamMessenger';
import { createDemoAdapter } from '@/lib/team-messaging-demo';
import type { MessagingAdapter, MessagingSnapshot } from '@/lib/team-messaging';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

async function fixture(content: string): Promise<MessagingSnapshot> {
  const data = await createDemoAdapter('office-pm', { getItem: () => null, setItem: () => {} }).load();
  const incoming = data.messages.find((m) => !m.mine && m.peer_id === 'tech-alex')!;
  return { ...data, messages: [{ ...incoming, content }] };
}
function adapter(load: MessagingAdapter['load']): MessagingAdapter {
  return { load, send: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue(undefined), respond: vi.fn().mockResolvedValue(undefined) };
}

describe('TeamMessenger refresh ownership', () => {
  it('does not let an older poll overwrite the latest conversation snapshot', async () => {
    const old = await fixture('Old snapshot');
    const latest = await fixture('Latest snapshot');
    let resolveOld!: (data: MessagingSnapshot) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<MessagingSnapshot>((resolve) => { resolveOld = resolve; })).mockResolvedValue(latest);
    render(<TeamMessenger adapter={adapter(load)} />);
    fireEvent.focus(window);
    await screen.findByText('Latest snapshot');
    await act(async () => { resolveOld(old); });
    expect(screen.queryByText('Old snapshot')).toBeNull();
    expect(screen.getByText('Latest snapshot')).toBeTruthy();
  });

  it('invalidates the previous adapter and acknowledges only observed incoming messages', async () => {
    const old = await fixture('Previous identity');
    const latest = await fixture('Current identity');
    let resolveOld!: (data: MessagingSnapshot) => void;
    const previous = adapter(() => new Promise((resolve) => { resolveOld = resolve; }));
    const current = adapter(vi.fn().mockImplementation(async () => structuredClone(latest)));
    vi.mocked(current.read).mockImplementation(async () => {
      expect(screen.getByLabelText('Conversation with Alex Carter').textContent).toContain('Current identity');
    });
    const { rerender } = render(<TeamMessenger adapter={previous} />);
    rerender(<TeamMessenger adapter={current} />);
    await screen.findByText('Current identity');
    await act(async () => { resolveOld(old); });
    expect(screen.queryByText('Previous identity')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Alex Carter/ }));
    await waitFor(() => expect(current.read).toHaveBeenCalledWith('tech-alex', [latest.messages[0].id]));
    expect(previous.read).not.toHaveBeenCalled();
  });

  it('publishes a completed poll even while a newer slow poll is still pending', async () => {
    const first = await fixture('First completed snapshot');
    const latest = await fixture('Newest completed snapshot');
    let resolveFirst!: (data: MessagingSnapshot) => void;
    let resolveLatest!: (data: MessagingSnapshot) => void;
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<MessagingSnapshot>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<MessagingSnapshot>((resolve) => { resolveLatest = resolve; }));
    render(<TeamMessenger adapter={adapter(load)} />);
    fireEvent.focus(window);
    await act(async () => { resolveFirst(first); });
    expect(screen.getByText('First completed snapshot')).toBeTruthy();
    await act(async () => { resolveLatest(latest); });
    expect(screen.getByText('Newest completed snapshot')).toBeTruthy();
    expect(screen.queryByText('First completed snapshot')).toBeNull();
  });
});
