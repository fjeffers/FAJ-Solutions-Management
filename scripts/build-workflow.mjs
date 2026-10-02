// Builds the WorkFlow app (Flutter, ../workflow — github fjeffers/primio-WorkFlow-3b2fad68)
// for the web and copies it into public/workflow, so it is served at
// app.fajsolutions.com/workflow/ from this same Vercel project.
//
// Vercel cannot build Flutter, so the built files are committed here. Run this
// after any change to WorkFlow, then commit public/workflow:
//
//   node scripts/build-workflow.mjs
//
// The database address and public (anon) key come from .env.local — the same
// ones this app's browser code already ships — and are baked in at build time.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const app = process.env.WORKFLOW_DIR ?? resolve(root, '..', 'workflow');
const flutter = process.env.FLUTTER ?? (existsSync('D:/tools/flutter/bin/flutter.bat') ? 'D:/tools/flutter/bin/flutter.bat' : 'flutter');

const env = Object.fromEntries(
  readFileSync(join(root, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env.local');
if (/\\n|\s/.test(url + key)) throw new Error('A Supabase value in .env.local contains a stray newline or space — fix it first.');

console.log(`Building WorkFlow from ${app} …`);
execFileSync(flutter, [
  'build', 'web', '--release', '--base-href', '/workflow/',
  `--dart-define=SUPABASE_URL=${url}`,
  `--dart-define=SUPABASE_ANON_KEY=${key}`,
  '--dart-define=OFFICE_URL=https://app.fajsolutions.com',
], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });

const out = join(root, 'public', 'workflow');
rmSync(out, { recursive: true, force: true });
// canvaskit/ (~37 MB) is left out: the app loads the same engine files from
// Google's CDN (www.gstatic.com/flutter-canvaskit/<engine>), which is Flutter's
// default and what flutter_bootstrap.js asks for, so the local copy is unused.
const built = join(app, 'build', 'web');
cpSync(built, out, { recursive: true, filter: (src) => !src.startsWith(join(built, 'canvaskit')) });

// Stamp which WorkFlow commit this build came from.
let commit = 'unknown';
try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: app }).toString().trim(); } catch { /* not a git checkout */ }
writeFileSync(join(out, 'version.txt'), `WorkFlow ${commit} built ${new Date().toISOString()}\n`);
console.log(`Copied to ${out} (WorkFlow ${commit}).`);
