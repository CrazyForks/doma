#!/usr/bin/env node
/**
 * Undo apply-pro residue on Open tracked paths.
 *
 * After `apply:pro` / `dev:pro` / `build:pro*`, same-path files under ./pro
 * overwrite Open stubs in the working tree. This restores those paths from
 * `HEAD` (Open repo truth) so `npm run dev` / commits stay clean.
 *
 * Does not delete gitignored Pro-only files (account, *.pro.ts, etc.) — they
 * are ignored and unused when VITE_BUILD_EDITION=open.
 *
 * Caution: uncommitted edits on overlapping paths are discarded (reset to HEAD).
 *
 *   npm run apply:open
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pro = join(root, 'pro');

/** Keep in sync with apply-pro-overlay.mjs SKIP */
const SKIP = new Set([
  '.git',
  '.gitignore',
  '.gitmodules',
  'README.md',
  'package.json',
  'CONTEXT.md',
  'node_modules',
  'dist',
  'core',
]);

if (!existsSync(pro)) {
  console.log('[apply-open] no ./pro — nothing to restore');
  process.exit(0);
}

function collectProFiles(rel = '', out = []) {
  const dir = rel ? join(pro, rel) : pro;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const relPath = rel ? `${rel}/${name}` : name;
    const from = join(pro, relPath);
    if (statSync(from).isDirectory()) {
      collectProFiles(relPath, out);
    } else {
      out.push(relPath.replace(/\\/g, '/'));
    }
  }
  return out;
}

function gitTrackedSet() {
  const r = spawnSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0) {
    console.error('[apply-open] git ls-files failed');
    process.exit(r.status || 1);
  }
  const set = new Set();
  const buf = r.stdout || Buffer.alloc(0);
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) {
      if (i > start) set.add(buf.subarray(start, i).toString('utf8'));
      start = i + 1;
    }
  }
  if (start < buf.length) set.add(buf.subarray(start).toString('utf8'));
  return set;
}

const proFiles = collectProFiles();
const tracked = gitTrackedSet();
const overlap = proFiles.filter((p) => tracked.has(p));

if (!overlap.length) {
  console.log('[apply-open] no overlapping tracked paths — ok');
  process.exit(0);
}

const checkout = spawnSync('git', ['checkout', 'HEAD', '--', ...overlap], {
  cwd: root,
  stdio: 'inherit',
});
if (checkout.status !== 0) {
  console.error('[apply-open] git checkout HEAD -- <overlap> failed');
  process.exit(checkout.status || 1);
}

console.log(
  `[apply-open] restored ${overlap.length} Open tracked path(s) from HEAD (undid apply-pro overlay on those files)`,
);
