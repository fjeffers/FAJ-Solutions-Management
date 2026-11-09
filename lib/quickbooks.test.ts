// Connecting QuickBooks, 2026-10-25: the company info call answered 403
// ApplicationAuthorizationFailed (3100), a real company asked of the sandbox.
// findCompany asks the other QuickBooks before giving up.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { findCompany, findInvoiceByNumber, getInvoiceStatus, invoicePaymentDates } from './quickbooks';

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

describe('findInvoiceByNumber', () => {
  it('matches work-order numbers with apostrophes without putting them in the QuickBooks query', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const query = new URL(url).searchParams.get('query') ?? '';
      asked.push(query);
      return new Response(JSON.stringify({
        QueryResponse: {
          Invoice: [
            { Id: '1', DocNumber: 'WO 1901448', TotalAmt: 100 },
            { Id: '2', DocNumber: "WO 19'01449", TotalAmt: 220 },
          ],
          maxResults: 2,
        },
      }), { status: 200 });
    }));

    await expect(findInvoiceByNumber('production', '9341', 'token', "WO 19'01449")).resolves.toEqual({
      id: '2',
      docNumber: "WO 19'01449",
      total: 220,
    });
    expect(asked).toEqual([
      'SELECT Id, DocNumber, TotalAmt FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 1000',
    ]);
  });
});

describe('QuickBooks receivables', () => {
  it('reads the current total and balance from QuickBooks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      Invoice: {
        Id: '88', DocNumber: 'LDS-5006902', TotalAmt: 1800, Balance: 450,
        EmailStatus: 'EmailSent', MetaData: { LastUpdatedTime: '2026-11-09T14:00:00-05:00' },
      },
    }), { status: 200 })));

    await expect(getInvoiceStatus('production', 'realm', 'token', '88')).resolves.toEqual({
      id: '88',
      docNumber: 'LDS-5006902',
      total: 1800,
      balance: 450,
      emailStatus: 'EmailSent',
      updatedAt: '2026-11-09T14:00:00-05:00',
    });
  });

  it('totals payments applied to each invoice and keeps the latest payment date', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      QueryResponse: {
        Payment: [
          { TxnDate: '2026-11-07', Line: [{ Amount: 600, LinkedTxn: [{ TxnId: '88', TxnType: 'Invoice' }] }] },
          { TxnDate: '2026-11-09', Line: [{ Amount: 750, LinkedTxn: [{ TxnId: '88', TxnType: 'Invoice' }] }] },
          { TxnDate: '2026-11-08', Line: [{ Amount: 50, LinkedTxn: [{ TxnId: 'other', TxnType: 'Invoice' }] }] },
        ],
        maxResults: 3,
      },
    }), { status: 200 })));

    const payments = await invoicePaymentDates('production', 'realm', 'token', ['88']);
    expect(payments.get('88')).toEqual({ amount: 1350, latestDate: '2026-11-09' });
    expect(payments.has('other')).toBe(false);
  });
});
