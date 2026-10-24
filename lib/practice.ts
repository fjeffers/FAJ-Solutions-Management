// The test copy of the app (faj-practice.vercel.app, its own database —
// Supabase faj-practice). Since 2026-10-23 that database holds a copy of the
// live data, real people and jobs, so the banner says so. The live app never
// sets NEXT_PUBLIC_PRACTICE_COPY; the practice deployment sets it to "1", which
// shows the banner and keeps scheduled emails and imports switched off.
export const isPracticeCopy = process.env.NEXT_PUBLIC_PRACTICE_COPY === '1';

/** The live app, where the office works every day. */
export const LIVE_APP_URL = 'https://app.fajsolutions.com';

// A Vercel preview: the copy built from a branch being worked on
// (…-git-<branch>-fjeffers-projects.vercel.app). Same live data, but no email
// key, so nothing sends from it. Fred worked on one all afternoon on
// 2026-10-24 and every Send to tech failed; the strip says which copy this is.
export const isPreviewCopy = process.env.NEXT_PUBLIC_DEPLOY_ENV === 'preview';
