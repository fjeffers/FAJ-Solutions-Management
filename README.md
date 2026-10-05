# nextjs-v2 — Blink Next.js sandbox template

Next.js 16 (App Router) sandbox template for Blink, mirroring `vite-react-v2`:
Bun installs, **Tailwind v3 + the Blink UI SDK (`@blinkdotnew/ui`)** (NOT shadcn),
the Blink SDK, and the analytics `widget.js` injected into the App Router root
layout. `@blinkdotnew/ui` re-exports all primitives + `cn`; `BlinkUIProvider` +
`Toaster` are wired in `app/providers.tsx` and the theme CSS is imported via
`@import '@blinkdotnew/ui/styles'` at the top of `app/globals.css`.

## Shape

- **Static export** (`next.config.ts` → `output: 'export'`). The published
  artifact is plain HTML/CSS/JS in `out/` (see `src/constants/publish.ts`:
  `nextjs → npm run build`, path `out`), served by Blink hosting exactly like
  the Vite template's `dist/`.
- **Frontend + Blink SDK only for the published build.** Server-only Next
  features (route handlers, server actions, SSR) run in the sandbox **preview**
  (`next dev`) but are NOT part of a static export — backend logic belongs in
  Blink functions / the Blink SDK. This matches the agent rule in
  the agent system prompt ("Next.js APIs → Blink edge functions" — now in `prompts/web.txt` / stack guidance).
- **Dev server**: the sandbox manager runs `npm run dev` in `/home/user`
  (`src/lib/sandbox/sandbox-improved.ts`), so the `dev` script is rewritten to
  `next dev -H 0.0.0.0 -p 3000`. `allowedDevOrigins` in `next.config.ts` lets
  the Blink/E2B preview domains reach the dev server (Next 16 requirement).

## Build & promote (E2B Template SDK)

Requires `E2B_API_KEY` in `../../.env.local`. See
[`docs/sandbox-template-dev-vs-prod.md`](../../docs/sandbox-template-dev-vs-prod.md).

> **Dependency / ordering:** the template installs **`@blinkdotnew/ui@0.5.0`**
> (the App-Router/RSC `'use client'` build). That stable version must be
> published from `blink-sdk` (PR #39) **before** the prod images are built here,
> or `bun install` won't resolve it. Order: merge blink-sdk → publish
> `@blinkdotnew/ui@0.5.0` → build prod images here → merge auto-engineer.

```bash
cd sandbox-templates/nextjs-v2

# 1. DEV build (alias nextjs-v2-dev) — iterate / verify here first
npx tsx build.dev.ts

# 2. Verify in a throwaway sandbox: `npm run dev` serves :3000, widget.js in
#    <head>, Blink UI renders in App Router with NO RSC errors, `npm run build`
#    emits out/.

# 3. After sign-off — PROD builds (standard + large). Build BOTH:
npx tsx build.prod.ts          # alias nextjs-v2        (2 vCPU / 2048 MB, default tier)
npx tsx build.large.prod.ts    # alias nextjs-v2-large  (4 vCPU / 4096 MB, max/team tier)
```

After the first build, paste the returned `template_id` into `e2b.toml`
(dev) / `e2b.toml.e2bprod` (prod).

> **Standard vs large:** `nextjs-v2` is 2 vCPU / 2048 MB; `nextjs-v2-large` is
> 4 / 4096 for max/team-tier workspaces (`sandbox-improved` appends `-large`).
> Next is heavier than Vite (Turbopack + Next 16 + React 19), so build the large
> variant for parity. (`build.large.dev.ts` → `nextjs-v2-large-dev` for testing.)

## Runtime wiring

- `src/lib/sandbox/sandbox-improved.ts` — `effective === 'nextjs'` →
  `baseTemplate = 'nextjs-v2'`; max/team tier → `nextjs-v2-large`.
- `src/lib/import/project-analyzer.ts` — imported repos with `next` in deps are
  classified `tech_stack: 'nextjs'` (deterministic, not AI-guessed).
- `src/constants/publish.ts` — `nextjs` build = `npm run build`, output `out`.
