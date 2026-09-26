import { describe, it, expect, vi } from 'vitest';
import { backdropClose } from './backdrop';

const backdrop = {} as EventTarget;
const field = {} as EventTarget;
const ev = (target: EventTarget) => ({ target, currentTarget: backdrop }) as never;

describe('backdropClose', () => {
  it('closes when the press starts and ends on the backdrop', () => {
    const close = vi.fn();
    const h = backdropClose(close);
    h.onMouseDown(ev(backdrop));
    h.onClick(ev(backdrop));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('stays open when the press starts in a field and ends on the backdrop', () => {
    // Picking a date, or dragging to select text, then letting go outside.
    const close = vi.fn();
    const h = backdropClose(close);
    h.onMouseDown(ev(field));
    h.onClick(ev(backdrop));
    expect(close).not.toHaveBeenCalled();
  });

  it('stays open for a click inside the form', () => {
    const close = vi.fn();
    const h = backdropClose(close);
    h.onMouseDown(ev(field));
    h.onClick(ev(field));
    expect(close).not.toHaveBeenCalled();
  });

  it('does not close on a click that arrives with no press seen first', () => {
    const close = vi.fn();
    const h = backdropClose(close);
    h.onClick(ev(backdrop));
    expect(close).not.toHaveBeenCalled();
  });
});
