// @vitest-environment jsdom
// Send to tech when the server answers with an empty body: the modal showed
// "Failed to execute 'json' on 'Response': Unexpected end of JSON input"
// (Fred, 2026-10-24). It now says what the server said, or that it didn't answer.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EmailModal from './EmailModal';

const payload = { type: 'work_order' as const, to: 'tech@example.com', subject: 'Work Order #1', data: {} };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('EmailModal', () => {
  it('shows the server\'s own message when it gives one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: "Email isn't set up on the server" }), { status: 503 })));
    render(<EmailModal payload={payload} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Send Email/ }));
    expect(await screen.findByText("Email isn't set up on the server")).toBeTruthy();
  });

  it('says the server did not answer when the body is empty, not a JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
    render(<EmailModal payload={payload} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Send Email/ }));
    expect(await screen.findByText(/The server didn't answer \(error 500\)/)).toBeTruthy();
    expect(screen.queryByText(/JSON/)).toBeNull();
  });
});
