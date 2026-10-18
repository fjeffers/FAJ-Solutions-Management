// Is this open copy of the app older than the one that's live? (components/UpdateBar.tsx)
// "dev" (a local build, or a build with no commit) never asks for an update.
export const BUILD_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'dev';

export function needsUpdate(build: string, live: unknown): boolean {
  if (typeof live !== 'string' || !live || live === 'dev' || !build || build === 'dev') return false;
  return live !== build;
}
