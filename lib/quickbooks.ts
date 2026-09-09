// Minimal QuickBooks Online API client for Phase 11 (payments -> Expense sync).
// Requires QBO_CLIENT_ID / QBO_CLIENT_SECRET from an Intuit Developer app. Start against a
// free Sandbox company (QBO_ENVIRONMENT=sandbox) before ever pointing this at production.

const INTUIT_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const INTUIT_TOKEN_URL = 'https://oauth2.bearer.token.intuit.com/oauth2/v1/tokens/bearer';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBase(environment: 'sandbox' | 'production'): string {
  return environment === 'production'
    ? 'https://quickbooks.api.intuit.com/v3/company'
    : 'https://sandbox-quickbooks.api.intuit.com/v3/company';
}

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base}/api/integrations/quickbooks/callback`;
}

export function getQuickBooksAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    state,
  });
  return `${INTUIT_AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body: URLSearchParams): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const basicAuth = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(INTUIT_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`QuickBooks token request failed: ${await res.text()}`);
  return res.json();
}

export async function exchangeCodeForTokens(code: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
  }));
}

export async function refreshAccessToken(refreshToken: string) {
  return tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

async function qboQuery<T>(environment: 'sandbox' | 'production', realmId: string, accessToken: string, query: string): Promise<T[]> {
  const url = `${apiBase(environment)}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`QuickBooks query failed: ${await res.text()}`);
  const data = await res.json();
  const entityKey = Object.keys(data.QueryResponse ?? {}).find((k) => k !== 'maxResults' && k !== 'startPosition');
  return entityKey ? data.QueryResponse[entityKey] : [];
}

export async function getCompanyName(environment: 'sandbox' | 'production', realmId: string, accessToken: string): Promise<string> {
  const url = `${apiBase(environment)}/${realmId}/companyinfo/${realmId}?minorversion=65`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`QuickBooks company info failed: ${await res.text()}`);
  const data = await res.json();
  return data.CompanyInfo?.CompanyName ?? 'QuickBooks Company';
}

export async function listAccounts(environment: 'sandbox' | 'production', realmId: string, accessToken: string): Promise<{ id: string; name: string; accountType: string }[]> {
  type QboAccount = { Id: string; Name: string; AccountType: string };
  const accounts = await qboQuery<QboAccount>(environment, realmId, accessToken, 'SELECT Id, Name, AccountType FROM Account WHERE Active = true MAXRESULTS 200');
  return accounts.map((a) => ({ id: a.Id, name: a.Name, accountType: a.AccountType }));
}

export async function findOrCreateVendor(environment: 'sandbox' | 'production', realmId: string, accessToken: string, name: string): Promise<string> {
  type QboVendor = { Id: string };
  const escaped = name.replace(/'/g, "\\'");
  const existing = await qboQuery<QboVendor>(environment, realmId, accessToken, `SELECT Id FROM Vendor WHERE DisplayName = '${escaped}'`);
  if (existing.length > 0) return existing[0].Id;

  const res = await fetch(`${apiBase(environment)}/${realmId}/vendor?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ DisplayName: name }),
  });
  if (!res.ok) throw new Error(`QuickBooks vendor create failed: ${await res.text()}`);
  const data = await res.json();
  return data.Vendor.Id;
}

/**
 * Creates or updates a vendor carrying the details from a filed W-9, so the
 * 1099 comes out of QuickBooks with the right legal name, TIN and address.
 * findOrCreateVendor only sets DisplayName — this is the W-9 path.
 */
export async function upsertVendorFromW9(
  environment: 'sandbox' | 'production',
  realmId: string,
  accessToken: string,
  w9: {
    displayName: string;
    legalName?: string | null;
    email?: string | null;
    phone?: string | null;
    taxId?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  },
): Promise<string> {
  type QboVendor = { Id: string; SyncToken: string };
  const escaped = w9.displayName.replace(/'/g, "\\'");
  const existing = await qboQuery<QboVendor>(
    environment, realmId, accessToken,
    `SELECT Id, SyncToken FROM Vendor WHERE DisplayName = '${escaped}'`,
  );

  const body: Record<string, unknown> = {
    DisplayName: w9.displayName,
    Vendor1099: true,
  };
  if (w9.legalName) body.CompanyName = w9.legalName;
  if (w9.email) body.PrimaryEmailAddr = { Address: w9.email };
  if (w9.phone) body.PrimaryPhone = { FreeFormNumber: w9.phone };
  if (w9.taxId) body.TaxIdentifier = w9.taxId;
  if (w9.address || w9.city || w9.state || w9.zip) {
    body.BillAddr = {
      Line1: w9.address ?? undefined,
      City: w9.city ?? undefined,
      CountrySubDivisionCode: w9.state ?? undefined,
      PostalCode: w9.zip ?? undefined,
    };
  }

  // Updating an existing vendor requires Id + SyncToken, or QuickBooks rejects it.
  if (existing.length > 0) {
    body.Id = existing[0].Id;
    body.SyncToken = existing[0].SyncToken;
    body.sparse = true;
  }

  const res = await fetch(`${apiBase(environment)}/${realmId}/vendor?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`QuickBooks vendor upsert failed: ${await res.text()}`);
  const data = await res.json();
  return data.Vendor.Id;
}

export async function createExpensePurchase(
  environment: 'sandbox' | 'production',
  realmId: string,
  accessToken: string,
  params: { vendorId: string; amount: number; date: string; paymentAccountId: string; expenseAccountId: string; memo: string },
): Promise<string> {
  const res = await fetch(`${apiBase(environment)}/${realmId}/purchase?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      PaymentType: 'Cash',
      AccountRef: { value: params.paymentAccountId },
      EntityRef: { value: params.vendorId, type: 'Vendor' },
      TxnDate: params.date,
      PrivateNote: params.memo,
      Line: [{
        Amount: params.amount,
        DetailType: 'AccountBasedExpenseLineDetail',
        AccountBasedExpenseLineDetail: { AccountRef: { value: params.expenseAccountId } },
      }],
    }),
  });
  if (!res.ok) throw new Error(`QuickBooks purchase create failed: ${await res.text()}`);
  const data = await res.json();
  return data.Purchase.Id;
}

// ─── Invoices (money IN) ────────────────────────────────────────────────────
//
// Everything above this line moves money OUT — vendors, expenses, 1099s. This
// section is the other direction, and it exists so QuickBooks can be the only
// place invoices are ever raised. The app describes the work; QuickBooks
// issues the document, owns the number and records the payment.

/** Look up a customer by the name FAJ bills, creating it only if truly absent. */
export async function findOrCreateCustomer(
  environment: 'sandbox' | 'production',
  realmId: string,
  accessToken: string,
  name: string,
): Promise<string> {
  type QboCustomer = { Id: string };
  const escaped = name.replace(/'/g, "\'");
  const existing = await qboQuery<QboCustomer>(
    environment, realmId, accessToken,
    `SELECT Id FROM Customer WHERE DisplayName = '${escaped}'`,
  );
  if (existing.length > 0) return existing[0].Id;

  const res = await fetch(`${apiBase(environment)}/${realmId}/customer?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ DisplayName: name }),
  });
  if (!res.ok) throw new Error(`QuickBooks customer create failed: ${await res.text()}`);
  const data = await res.json();
  return data.Customer.Id;
}

/**
 * The Service item every invoice line is booked against.
 *
 * QuickBooks requires an ItemRef on a sales line. FAJ bills labour, travel and
 * materials as free-text descriptions rather than a product catalogue, so one
 * generic service item carries them all and the description does the talking.
 */
export async function findOrCreateServiceItem(
  environment: 'sandbox' | 'production',
  realmId: string,
  accessToken: string,
  name = 'Field Services',
): Promise<string> {
  type QboItem = { Id: string };
  const escaped = name.replace(/'/g, "\'");
  const existing = await qboQuery<QboItem>(
    environment, realmId, accessToken,
    `SELECT Id FROM Item WHERE Name = '${escaped}'`,
  );
  if (existing.length > 0) return existing[0].Id;

  // A Service item needs an income account to post to. Pick the company's own
  // income account rather than guessing at a name that may not exist.
  const income = await qboQuery<{ Id: string }>(
    environment, realmId, accessToken,
    `SELECT Id FROM Account WHERE AccountType = 'Income' MAXRESULTS 1`,
  );
  if (income.length === 0) {
    throw new Error('QuickBooks has no income account to book invoice lines against.');
  }

  const res = await fetch(`${apiBase(environment)}/${realmId}/item?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Name: name,
      Type: 'Service',
      IncomeAccountRef: { value: income[0].Id },
    }),
  });
  if (!res.ok) throw new Error(`QuickBooks item create failed: ${await res.text()}`);
  const data = await res.json();
  return data.Item.Id;
}

/**
 * Create the invoice and hand back what QuickBooks decided.
 *
 * DocNumber is deliberately NOT sent: QuickBooks owns the sequence. The number
 * it returns is the one written back onto the visits, so the app and the
 * ledger refer to the same document forever after.
 */
export async function createInvoice(
  environment: 'sandbox' | 'production',
  realmId: string,
  accessToken: string,
  payload: Record<string, unknown>,
): Promise<{ id: string; docNumber: string; total: number; balance: number }> {
  const res = await fetch(`${apiBase(environment)}/${realmId}/invoice?minorversion=65`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`QuickBooks invoice create failed: ${await res.text()}`);
  const data = await res.json();
  const inv = data.Invoice;
  return {
    id: String(inv.Id),
    docNumber: String(inv.DocNumber ?? ''),
    total: Number(inv.TotalAmt ?? 0),
    balance: Number(inv.Balance ?? 0),
  };
}
