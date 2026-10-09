// The developer's practice copy of the app (Fred, 2026-10-09: a separate
// copy with made-up data, its own database — Supabase faj-practice). The live
// app never sets NEXT_PUBLIC_PRACTICE_COPY; the practice deployment sets it to
// "1", which shows a banner and keeps scheduled emails and imports switched off.
export const isPracticeCopy = process.env.NEXT_PUBLIC_PRACTICE_COPY === '1';
