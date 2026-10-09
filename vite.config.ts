import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Build stamp for the REV plate in the spec panel: package version, short commit and build date. On Vercel the commit
// comes from VERCEL_GIT_COMMIT_SHA; locally from git; DEV when neither is there. Every deploy gets a new stamp.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
function sha(): string {
  const env = process.env.VERCEL_GIT_COMMIT_SHA;
  if (env) return env.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'DEV';
  }
}

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(sha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: { fs: { deny: ['_ref'] } },
});
