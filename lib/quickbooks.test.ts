// Connecting QuickBooks, 2026-10-25: the company info call answered 403
// ApplicationAuthorizationFailed (3100), a real company asked of the sandbox.
// findCompany asks the other QuickBooks before giving up.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { findCompany } from './quickbooks';

const FAULT = JSON.stringify({ fault: { error: [{ message: 'message=ApplicationAuthorizationFailed; errorCode=003100; statusCode=403', code: '3100' }], type: 'SERVICE' } });
function quickbooks(company: { host: string; name: string }) {
  const asked: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(new URL(url).host);
    return new URL(url).host === company.host
      ? new Response(JSON.stringify({ CompanyInfo: { CompanyName: company.name } }), { status: 200 })
      : new Response(FAULT, { status: 403 });
  }));
  return asked;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('findCompany', () => {
  it('finds a real company when the sandbox is set, and says it is production', async () => {
    const asked = quickbooks({ host: 'quickbooks.api.intuit.com', name: 'FAJ Solutions LLC' });
    expect(await findCompany('sandbox', '9341', 'token')).toEqual({ environment: 'production', companyName: 'FAJ Solutions LLC' });
    expect(asked).toEqual(['sandbox-quickbooks.api.intuit.com', 'quickbooks.api.intuit.com']);
  });

  it('asks only the one set when the company is there', async () => {
    const asked = quickbooks({ host: 'sandbox-quickbooks.api.intuit.com', name: 'Sandbox Company_US_1' });
    expect(await findCompany('sandbox', '9341', 'token')).toEqual({ environment: 'sandbox', companyName: 'Sandbox Company_US_1' });
    expect(asked).toEqual(['sandbox-quickbooks.api.intuit.com']);
  });

  it("gives the first answer's error when neither has the company", async () => {
    quickbooks({ host: 'nowhere.example', name: '' });
    await expect(findCompany('production', '9341', 'token')).rejects.toThrow(/ApplicationAuthorizationFailed/);
  });
});
