import { describe, expect, it } from 'vitest';
import { ADMIN_AUTH_COOKIE, cookieOptionsFor, hasAdminSessionCookie, sideForApiRequest, sideForPath } from './side';

describe('separate sign-ins for the office and the tech portal', () => {
  it('pages: the office is /admin (and the old / and /login that forward to it); everything else is the field side', () => {
    for (const p of ['/admin', '/admin/login', '/', '/login']) expect(sideForPath(p)).toBe('admin');
    for (const p of ['/tech', '/tech/login', '/assistant', '/accountant/login', '/reset-password', '/portal/abc', '/administrator', '/admins'])
      expect(sideForPath(p)).toBe('field');
  });

  it('API calls go by the page that made them', () => {
    expect(sideForApiRequest('https://app.fajsolutions.com/admin?view=quickbooks', false)).toBe('admin');
    expect(sideForApiRequest('https://app.fajsolutions.com/tech', true)).toBe('field');
    expect(sideForApiRequest('https://app.fajsolutions.com/portal/abc?view=paperwork', true)).toBe('field');
    // No page to go by: the office only if this browser is signed into it.
    expect(sideForApiRequest(null, true)).toBe('admin');
    expect(sideForApiRequest(null, false)).toBe('field');
    expect(sideForApiRequest('not a url', false)).toBe('field');
  });

  it('the office has its own cookie; the tech portal keeps the default, so no tech was signed out', () => {
    expect(cookieOptionsFor('admin')).toEqual({ name: ADMIN_AUTH_COOKIE });
    expect(cookieOptionsFor('field')).toBeUndefined();
    expect(hasAdminSessionCookie([`${ADMIN_AUTH_COOKIE}.0`, 'other'])).toBe(true);
    expect(hasAdminSessionCookie([ADMIN_AUTH_COOKIE])).toBe(true);
    expect(hasAdminSessionCookie(['sb-izrjdhuosxtqteftzkhd-auth-token', `${ADMIN_AUTH_COOKIE}-code-verifier`])).toBe(false);
  });
});
