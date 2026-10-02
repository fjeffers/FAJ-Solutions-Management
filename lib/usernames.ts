// Usernames for the tech portal sign-in (migration-099). Pure and unit-tested;
// the database enforces the same rule (login_usernames_format).

export const USERNAME_RULE = '3–30 characters: letters, numbers, dot, dash or underscore';

/** How a username is stored: trimmed and lower-case. */
export function normalizeUsername(raw: string): string {
  return (raw ?? '').trim().toLowerCase();
}

/** What is wrong with a username, in plain words — or null when it is fine. */
export function usernameProblem(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (!u) return 'Pick a username.';
  if (u.length < 3) return 'Use at least 3 characters for your username.';
  if (u.length > 30) return 'Keep your username to 30 characters or fewer.';
  if (u.includes('@')) return "A username can't have an @ in it. Your email goes in the email box.";
  if (/\s/.test(u)) return "A username can't have spaces. Try a dot instead, like jere.jones.";
  if (!/^[a-z0-9]/.test(u)) return 'Start your username with a letter or number.';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(u)) return `Use only letters, numbers, dot, dash or underscore (${USERNAME_RULE}).`;
  return null;
}

/** The sign-in box takes a username or an email. */
export function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((raw ?? '').trim());
}

/** A suggestion from a name: "Jere Jones" → "jere.jones". */
export function suggestUsername(name: string): string {
  const parts = (name ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s.-]/g, '').trim().split(/\s+/).filter(Boolean);
  const s = parts.join('.').replace(/_/g, '').replace(/^[^a-z0-9]+/, '').slice(0, 30);
  return s.length >= 3 ? s : '';
}
