// @vitest-environment jsdom
//
// The work order's header shows the hours as billed, with the office's changes,
// over the techs' own clock (Fred, 2026-10-24: "i updated the time loge but it
// did not reflect in the work order").
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { wfJobFromOwner } from '@/lib/wf';
import { DetailHeader } from './WfJobDetail';

const job = wfJobFromOwner({ id: 'wo', wo_number: '19101401', title: 'LDS Site', wo_status: 'In Progress', contractor_names: ['Paul Gibbs'] } as never);
afterEach(cleanup);

describe('DetailHeader', () => {
  it('shows the hours as billed first when the office has them', () => {
    render(<DetailHeader job={job} ownerView loggedMs={0} billedHours={42.6} />);
    expect(screen.getByText('Hours on site: 42.60 h (as billed)')).toBeTruthy();
    expect(screen.getByText("Techs' clock: 0m")).toBeTruthy();
  });
  it('shows the time logged alone otherwise', () => {
    render(<DetailHeader job={job} ownerView loggedMs={3_600_000} />);
    expect(screen.getByText(/^Time logged: 1h/)).toBeTruthy();
  });
});
