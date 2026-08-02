/**
 * Walking the repository's own source, for the boundary guards.
 *
 * Shared by `ai-optional.test.ts` and `maps-optional.test.ts`, which enforce
 * the same shape of rule about two different external dependencies: everything
 * that assumes the dependency exists lives in one named directory, and the rest
 * of the app works without it.
 *
 * Not named `*.test.ts`, so vitest's `tests/guards/**\/*.test.ts` include does
 * not try to run it as a suite.
 */
import { readdirSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** `tests/` is excluded: a guard has to be able to name what it forbids. */
export const SCANNED = ['apps', 'packages', 'supabase'];

const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function sourceFilesIn(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFilesIn(full, found);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) found.push(full);
  }
  return found;
}

/** Every source file the guards consider. */
export function scannedFiles(): string[] {
  return SCANNED.flatMap((dir) => {
    const full = join(REPO_ROOT, dir);
    return statSync(full).isDirectory() ? sourceFilesIn(full) : [];
  });
}

/**
 * Is this `.../features/<name>/<segment>/...`?
 *
 * Positional on purpose, and one level between `features` and the segment: the
 * rule is that an external dependency belongs to *a* feature, so
 * `features/maps/` at the top level does not qualify.
 */
export function isFeatureSegmentPath(relativePath: string, segment: string): boolean {
  const parts = relativePath.split(sep);
  const features = parts.indexOf('features');
  return features !== -1 && parts[features + 2] === segment;
}
