// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { pickFirst, techShown, TECH_PICK_KEY, useTechPick } from './tech-pick';

afterEach(() => sessionStorage.clear());

describe('the tech picked on Hours and the Field Sheet', () => {
  it('stays picked when the screen opens again, until All techs is picked', () => {
    const first = renderHook(() => useTechPick());
    act(() => first.result.current[1]('Frederick Jeffers'));
    first.unmount();
    const again = renderHook(() => useTechPick());
    expect(again.result.current[0]).toBe('Frederick Jeffers');
    act(() => again.result.current[1](''));
    expect(sessionStorage.getItem(TECH_PICK_KEY)).toBeNull();
  });

  it("shows everyone on a job that tech isn't on, and puts the tech first to add a day", () => {
    expect(techShown('Ana', ['Ana', 'Bo'])).toBe('Ana');
    expect(techShown('Ana', ['Bo'])).toBe('');
    expect(pickFirst('Bo', ['Ana', 'Bo'])).toEqual(['Bo', 'Ana']);
    expect(pickFirst('', ['Ana', 'Bo'])).toEqual(['Ana', 'Bo']);
  });
});
