// What a new password has to be, said in plain words (Fred, 2026-10-05:
// "whenever I try changing the PW it doesn't take, both for myself and tech").
// The same rule is checked in the browser (to say what's wrong at once) and on
// the server (app/api/account/password), which is what actually decides.

export const PASSWORD_MIN = 8;

/** Null when the new password is fine; otherwise what to fix. */
export function passwordProblem(next: string, confirm: string, current?: string): string | null {
  if (current !== undefined && !current) return 'Type your current password.';
  if (next.length < PASSWORD_MIN) return `The new password needs at least ${PASSWORD_MIN} characters.`;
  if (next.length > 72) return 'The new password is too long (72 characters at most).';
  if (/^\s|\s$/.test(next)) return "The new password can't start or end with a space.";
  if (next !== confirm) return "The two new passwords don't match.";
  if (current !== undefined && next === current) return 'The new password is the same as the current one.';
  return null;
}
