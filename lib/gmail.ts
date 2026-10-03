// Minimal Gmail API client for the email-import feature (Phase 9).
// Requires GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars from a Google Cloud OAuth app
// (Web application type, "Testing" publish status is fine for a single internal user).
// Scope used: gmail.readonly (we only ever read mail, never modify/delete/send).

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://www.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${base}/api/integrations/gmail/callback`;
}

export function getGmailAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force refresh_token issuance every connect
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string; refresh_token: string; expires_in: number;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${await res.text()}`);
  return res.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string; expires_in: number;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  return res.json();
}

export async function getUserEmail(accessToken: string): Promise<string> {
  const res = await fetch(`${GMAIL_API}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail profile fetch failed: ${await res.text()}`);
  const data = await res.json();
  return data.emailAddress;
}

export type GmailMessageSummary = { id: string; threadId: string };

export async function listMessages(accessToken: string, query: string): Promise<GmailMessageSummary[]> {
  const params = new URLSearchParams({ q: query, maxResults: '25' });
  const res = await fetch(`${GMAIL_API}/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail list failed: ${await res.text()}`);
  const data = await res.json();
  return data.messages ?? [];
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

function extractHtmlBody(payload: unknown): string {
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  if (p.mimeType === 'text/html' && p.body?.data) return decodeBase64Url(p.body.data);
  if (p.parts) {
    for (const part of p.parts) {
      const found = extractHtmlBody(part);
      if (found) return found;
    }
  }
  if (p.mimeType === 'text/plain' && p.body?.data) return decodeBase64Url(p.body.data);
  return '';
}

export async function getMessage(accessToken: string, id: string): Promise<{ subject: string; from: string; htmlBody: string }> {
  const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail get message failed: ${await res.text()}`);
  const data = await res.json();
  const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
  const subject = headers.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
  const from = headers.find((h) => h.name.toLowerCase() === 'from')?.value ?? '';
  const htmlBody = extractHtmlBody(data.payload);
  return { subject, from, htmlBody };
}

function extractPart(payload: unknown, mime: string): string {
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  if (p.mimeType === mime && p.body?.data) return decodeBase64Url(p.body.data);
  for (const part of p.parts ?? []) {
    const found = extractPart(part, mime);
    if (found) return found;
  }
  return '';
}

/** One message for the support bot: headers plus the plain-text body (HTML only when there is no text part). */
export async function getMessageForSupport(accessToken: string, id: string): Promise<{
  subject: string; from: string; to: string; date: string; threadId: string; text: string; html: string;
}> {
  const res = await fetch(`${GMAIL_API}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail get message failed: ${await res.text()}`);
  const data = await res.json();
  const headers: { name: string; value: string }[] = data.payload?.headers ?? [];
  const h = (n: string) => headers.find((x) => x.name.toLowerCase() === n)?.value ?? '';
  return {
    subject: h('subject'), from: h('from'), to: h('to'), date: h('date'), threadId: data.threadId ?? '',
    text: extractPart(data.payload, 'text/plain'), html: extractPart(data.payload, 'text/html'),
  };
}
