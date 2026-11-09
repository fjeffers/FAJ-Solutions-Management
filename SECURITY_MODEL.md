# Security model: FAJ Solutions field-ops app + FieldService Live

Threat model used to rank security scan findings (2026-11-09). Facts marked **(Fred)** come from Fred; everything else is read from the code. Covers this repo plus FieldService Live (`fjeffers/lds-netview-checkout`, `fjeffers/FieldService.app`), which are scanned together.

## 1. System overview

Three repositories, scanned together:

- **FAJ-Solutions-Management** (`fjeffers/FAJ-Solutions-Management`): Next.js 16 app on Vercel (app.fajsolutions.com) on Supabase (Postgres, Auth, Storage). One business, FAJ Solutions. Fred is the only office administrator; field techs are 1099 contractors; there are also assistant and accountant logins.
- **FieldService Live** (`fjeffers/lds-netview-checkout`, the repo's old name): Next.js app on Vercel, the multi-company product Fred sells. Its own signed session cookie `fsl_s` (HMAC with `SESSION_SECRET`, `lib/session.ts`), roles Tech / PM / Admin per company, data in Supabase reached with the **service-role key** and scoped per company in code (`lib/supabase-store.ts` `companyId()`), with a Smartsheet fallback backend (`lib/smartsheet.ts`).
- **FieldService.app** (`fjeffers/FieldService.app`): FieldService Live product brief (`BRIEF.md`) and HTML mockups (`design/*.html`). No server code; nothing is deployed from it.
- Infrastructure: Vercel and Supabase are configured in their dashboards; no infrastructure-as-code repository exists. FAJ's schema/RLS/RPCs are the `supabase-migration-*.sql` files at its repo root, applied by hand (the repo is not proof a migration is live). FieldService Live's are `supabase/migrations/0001-0006`.

## 2. Components

| Component | Code it covers | Who reaches it |
|---|---|---|
| **Office app** | FAJ `app/admin/**`, `app/page.tsx`, `app/login/**`, `components/**`, office API routes in `app/api/**` guarded by `requireAdminUser` / `ownerOnly` (`lib/security.ts`) | Fred only (owner role from `wf_role()`), cookie `sb-faj-admin-auth-token` |
| **Staff portals** | FAJ `app/assistant/**`, `app/accountant/**`, `app/api/accountant/**` (W-9s) | Assistant and accountant logins |
| **Tech portal** | FAJ `app/tech/**`, `app/api/tech/**`, `app/api/jobs/**`, `app/api/wo-time-logs`, `public/tech-sw.js`, offline outbox in `lib/` | Contractor techs on the "field" cookie; offline-first PWA that stays signed in |
| **Client links** | FAJ token pages `app/portal/[token]`, `app/invoice/[token]`, `app/billing/[token]`, `app/quote/[token]`, `app/site-report/[token]`, `app/sheet/[token]/**`, `app/api/portal/**` | Anyone holding the link (no login); `PUBLIC_PREFIXES` in `proxy.ts` |
| **Integrations & jobs** | FAJ `app/api/integrations/**` (Gmail, QuickBooks OAuth), `app/api/quickbooks/**`, `app/api/cron/**`, `app/api/import-queue/**`, `app/api/support/**`, `lib/email-parsers/**`, `app/api/ai/**`, `app/api/survey-vision`, `app/api/alerts/**`, `app/api/notify`, `app/api/send-email` | Fred, Vercel Cron (`CRON_SECRET`), inbound email content, Intuit, Google, Anthropic, Resend, Web Push |
| **Database** | FAJ `supabase-migration-*.sql` (RLS, `security definer` RPCs, storage policies), `lib/supabase/**` (`admin.ts` = service-role client) | Every FAJ component; the anon key is public in the browser |
| **FSL app** | `lds-netview-checkout` `middleware.ts`, `lib/session.ts`, `lib/access.ts`, `lib/users.ts`, `lib/supabase-store.ts`, `lib/smartsheet*.ts`, signed-in pages (`app/work`, `app/admin`, `app/schedule`, `app/team`, `app/timesheet`, `app/pay`, `app/files`, ...) and `app/api/**` except the public routes below; plus `FieldService.app` brief and mockups | Each company's Tech / PM / Admin; Fred's platform owner PIN (`ADMIN_PIN`) |
| **FSL public & billing** | `lds-netview-checkout` public routes in `OPEN` (`middleware.ts`): `/api/login`, `/api/signup`, `/api/live`, `/api/live/file`, `/api/live/pay`, `/api/demo-interest`, `/api/reminders`; pages `app/live/[token]`, `app/c/[slug]`, `app/s/[site]`, `app/welcome`, `app/see-demo`, `app/demo`, `app/signup`; `lib/share.ts`, `lib/live.ts`, Stripe (`app/api/stripe`, `lib/stripe-server.ts`), QuickBooks (`app/api/quickbooks`, `lib/quickbooks-server.ts`), `lib/mail.ts`, `lib/sms.ts` | Anyone on the internet; clients with a signed live link; Stripe and Intuit callbacks |

## 3. Trust boundaries and entry points

1. **FAJ `proxy.ts`** redirects signed-out page requests to a login but **does not authenticate `/api/*`** and passes every `PUBLIC_PREFIXES` path. Each API route must check the caller itself.
2. **FAJ two sign-in sides** (`lib/supabase/side.ts`): an `/api` call picks office vs field cookie from the `Referer`, falling back to the office cookie. Authorization must come from the role check (`ownerOnly` / RLS), not from the side picked.
3. **FAJ browser → Supabase** with the anon key: RLS and `security definer` RPCs (`wf_role`, `tech_claim_account`, portal RPCs from migrations 021/024/048) are the real access control for most FAJ data.
4. **FAJ service-role client** (bypasses RLS) is used in ~40 server routes, including `app/api/tech/*`, token pages (`app/billing/[token]`, `app/quote/[token]`, `app/sheet/[token]/*`), alerts, notify and QuickBooks; each must check ownership itself.
5. **FSL middleware** (`middleware.ts`) strips and re-sets `x-fsl-user` from the signed cookie, blocks Techs from `/api/admin/*`, and lets the `OPEN` set through. Everything else (tech-to-site assignment via `canAccessSite`, PM vs Admin, company scoping) is enforced per route, because Supabase is reached with the service-role key and RLS does not apply.
6. **FSL tenant isolation**: the company comes from the session (`c`) or `FSL_COMPANY`; `runAsCompany`/`inCompany` switch it. A route that takes a company or site from the request instead of the session can cross tenants.
7. **Token links**: FAJ tokens and FSL HMAC live links (`lib/share.ts`, signature truncated to 32 chars, file links to 24) grant access to one job by possession.
8. **Inbound content**: FAJ email import / support-from-email parse attacker-controllable email; uploads (photos, PDFs, receipts) in both apps; AI routes send job data to Anthropic.
9. **OAuth and payments**: Gmail/QuickBooks callbacks (FAJ), QuickBooks and Stripe Connect (FSL) store tokens server-side (FSL encrypts QuickBooks tokens with AES-GCM keyed from `SESSION_SECRET`, `lib/quickbooks-server.ts`).

## 4. Assets

All of the following matter equally **(Fred)**:

- **Money**: pay rates, payouts, pay add-ons, invoices, client rates, Stripe payments. FAJ techs must never see any amounts (migration 138 `no-pay-for-techs`).
- **Tax info**: contractor W-9s and IDs (FAJ `app/api/accountant/w9`, migration 052).
- **Integration credentials**: QuickBooks, Gmail and Stripe tokens; `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `CRON_SECRET`, `ADMIN_PIN`, API keys in Vercel env.
- **Customer data**: customer and site details, addresses, contacts, site photos, signatures, documents, messages; in FSL, each company's data must stay inside that company.
- **Tech personal data**: GPS punches, home address, mileage, phone, emergency contacts.

## 5. Attackers that matter

All of these matter equally **(Fred)**:

- A **signed-in tech or contractor** seeing other techs' jobs, pay or money, or office data, or acting on jobs not assigned to them (FAJ On Hold jobs are view-only). In FSL also: a Tech or PM of one company, or a company admin, reaching another company's data.
- **Someone with a forwarded client / invoice / sheet / live link** seeing more than that one job (other jobs, other invoices, internal pay fields, other companies).
- An **outsider on the internet with no login**: unauthenticated `/api` routes, signup, login/PIN guessing, cron, OAuth and payment callbacks, demo funnel.
- A **lost or stolen tech phone** that stays signed in (FAJ tech portal deliberately has no cutoff; offline caches in localStorage/IndexedDB).

Also in scope, from the code: assistant/accountant logins reaching owner-only data; malicious content in imported emails or uploaded files.

## 6. Existing controls

- FAJ: `ownerOnly()` / `requireAdminUser()` (`lib/security.ts`), `wf_role()`; separate office/field cookies; RLS throughout migrations (portal hardening 021/048, tech-sees-live-work-only 083, job messages owner-only 108, no pay for techs 138, held jobs view-only 153); cron routes require `Bearer $CRON_SECRET`; tech signup requires the email on the contractor record plus email confirmation.
- FSL: HMAC-signed session cookie with expiry; 6-digit PINs hashed with HMAC, `MAX_TRIES = 5` failed attempts (`lib/users.ts`); `canAccessSite` for techs; signed live links and file links; client messages limited to 5/minute; integrations table readable only by the service role (migration 0005); RLS `company_only` policies exist but the app bypasses them with the service-role key.

## 7. Out of scope / accepted risk (Fred)

- **Forwarded client links**: link = access. A finding that only says "anyone holding a valid link sees that one job / invoice / live page" is accepted. A link that reaches *more* than its own job (other jobs, other invoices, internal pay fields, another company) is still in scope.
- **Fred's own admin login stolen**: out of scope. Findings that require an attacker to already hold Fred's FAJ owner session or the FSL platform owner PIN, or that are only abusable by Fred himself, are accepted. (A tenant company's admin in FSL is not Fred and stays in scope.)
- **Old folders in the FAJ repo**: `backups/`, `Dunkin/`, `Sanctuary Wealth/`, `design/` (including `backups/crew-projects-backup-2026-10-03.json`).
- Otherwise: check everything.

## 8. Open questions

- Does "old folders" also cover the `FieldService.app` mockups (`design/*.html`)? Assumed no: only the FAJ repo's root folders.
