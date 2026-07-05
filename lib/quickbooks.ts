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
