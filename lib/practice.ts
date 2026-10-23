// The test copy of the app (faj-practice.vercel.app, its own database —
// Supabase faj-practice). Since 2026-10-23 that database holds a copy of the
// live data, real people and jobs, so the banner says so. The live app never
// sets NEXT_PUBLIC_PRACTICE_COPY; the practice deployment sets it to "1", which
// shows the banner and keeps scheduled emails and imports switched off.
export const isPracticeCopy = process.env.NEXT_PUBLIC_PRACTICE_COPY === '1';
