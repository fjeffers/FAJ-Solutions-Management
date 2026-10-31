// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OffSiteDialog } from './ProjectDay';

afterEach(cleanup);

describe('OffSiteDialog', () => {
  it("won't finish a site with items missing, and Go to it takes the tech to each one", () => {
    const onGo = vi.fn();
    const onFinished = vi.fn();
    render(<OffSiteDialog missing={['Add at least one photo of the work', 'Get the customer to sign off under Closeout']}
      onClose={() => {}} onBack={() => {}} onFinished={onFinished} onGo={onGo} />);
    fireEvent.click(screen.getByRole('button', { name: /this site is finished/i }));
    expect((screen.getByRole('button', { name: /site finished/i }) as HTMLButtonElement).disabled).toBe(true);
    const go = screen.getAllByRole('button', { name: 'Go to it' });
    expect(go).toHaveLength(2);
    fireEvent.click(go[1]);
    expect(onGo).toHaveBeenCalledWith('Get the customer to sign off under Closeout');
    expect(onFinished).not.toHaveBeenCalled();
  });
});
