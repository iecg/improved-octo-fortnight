/**
 * Nothing user-written may sit in a column anyone can read.
 *
 * The schema was moved to sealed payloads in one change, and the thing most
 * likely to undo it is not malice but convenience: a column added back "just
 * for sorting", or a new table that nobody thought of as content. Both are one
 * line, both look reasonable in review, and both are silent.
 *
 * So this is a grep with a reason attached, in the spirit of
 * `tests/guards/ai-optional.test.ts` — cheap, dependency-free, and failing
 * loudly the first time the rule stops being true.
 *
 * Four rules:
 *
 *   1. every column of every table is on the allowlist below, and the
 *      allowlist has no entries that no longer exist
 *   2. every key `packages/data` sends to PostgREST is a real column of the
 *      table it is sending it to
 *   3. `packages/crypto` imports nothing that ties it to a runtime
 *   4. the scanners actually found something
 *
 * Rules 1 and 2 share one allowlist on purpose. A denylist of known-bad names
 * would catch a re-added `notes` and wave through an invented `mood_summary`;
 * an allowlist catches both, and makes adding a genuinely new column a
 * deliberate two-place edit rather than an accident.
 *
 * `tests/` is never walked. `tests/rls/policies.test.ts` names
 * `expo_push_token` and `checkin_interest` inside assertions that they are
 * *absent*, which is exactly right there and would be a false positive here.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = join(REPO_ROOT, 'supabase', 'migrations');
const DATA_SRC = join(REPO_ROOT, 'packages', 'data', 'src');
const CRYPTO_SRC = join(REPO_ROOT, 'packages', 'crypto', 'src');

/**
 * Every column of every table, as the migrations leave them.
 *
 * A specification, not a permission slip: rule 1 fails both for a column that
 * is not here and for a name here that no longer exists. That second half is
 * what stops `expo_push_token` being quietly re-permitted — putting it back on
 * this list fails until someone also re-adds the column, at which point the
 * first half fires.
 */
const ALLOWED_COLUMNS: Record<string, readonly string[]> = {
  profiles: ['id', 'name_payload', 'timezone', 'locale', 'created_at', 'updated_at'],
  couples: ['id', 'invite_code', 'anniversary_date', 'timezone', 'created_at', 'updated_at'],
  couple_members: ['couple_id', 'profile_id', 'joined_at'],
  cadences: [
    'id',
    'couple_id',
    'domain',
    'kind',
    'interval_value',
    'interval_unit',
    'enabled',
    'created_at',
    'updated_at',
  ],
  plans: [
    'id',
    'couple_id',
    'domain',
    'kind',
    'payload',
    'starts_at',
    'ends_at',
    'status',
    'created_by',
    'completed_at',
    'calendar_event_ids',
    'created_at',
    'updated_at',
  ],
  plan_proposals: [
    'id',
    'plan_id',
    'couple_id',
    'proposed_by',
    'starts_at',
    'ends_at',
    'response',
    'responded_at',
    'responded_by',
    'countered_from',
    'created_at',
    'updated_at',
  ],
  checkins: ['id', 'couple_id', 'profile_id', 'on_date', 'payload', 'created_at', 'updated_at'],
  plan_ideas: ['id', 'couple_id', 'domain', 'kind', 'payload', 'source', 'saved_by', 'created_at'],
  ai_usage: ['couple_id', 'day', 'request_count'],
  join_attempts: ['profile_id', 'attempts', 'window_started_at'],
  device_keys: ['id', 'profile_id', 'public_key', 'created_at'],
  couple_key_wraps: [
    'couple_id',
    'device_key_id',
    'epoch',
    'wrapped_key',
    'wrapped_by',
    'created_at',
  ],
  couple_key_recovery: [
    'profile_id',
    'couple_id',
    'epoch',
    'kdf',
    'kdf_salt',
    'kdf_params',
    'wrapped_key',
    'created_at',
    'updated_at',
  ],
};

// --------------------------------------------------------------------- files

const IGNORED_DIRS = new Set(['node_modules', '.git', '.expo', 'dist', 'ios', 'android']);

function filesIn(dir: string, extensions: Set<string>, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) filesIn(full, extensions, found);
    else if (extensions.has(extname(entry))) found.push(full);
  }
  return found;
}

const migrationFiles = filesIn(MIGRATIONS, new Set(['.sql'])).sort();
const dataFiles = filesIn(DATA_SRC, new Set(['.ts'])).filter((f) => !f.endsWith('.test.ts'));
const cryptoFiles = filesIn(CRYPTO_SRC, new Set(['.ts']));

// ----------------------------------------------------------------- sql scan

interface ScannedSql {
  /** The source with comments and dollar-quoted bodies blanked out. */
  code: string;
  /** Those bodies, kept so DDL cannot hide inside a security-definer function. */
  bodies: string[];
}

/**
 * Blank a region, keeping its length and its newlines, so offsets and reported
 * line numbers still line up with the file on disk.
 */
function blanked(source: string, start: number, end: number): string {
  let out = '';
  for (let index = start; index < end; index += 1) out += source[index] === '\n' ? '\n' : ' ';
  return out;
}

/**
 * One state-aware pass over a migration.
 *
 * Every rule below depends on this, because all three of the following are
 * already in this repo and every one of them defeats a regex:
 *
 *  - comments describing the columns that were *removed* (`notes`, `location`)
 *  - `$$` function bodies containing `update public.profiles ...`
 *  - `check (public_key ~ '^[A-Za-z0-9+/]{40,64}={0,2}$')`, which puts `(`,
 *    `)`, `,` and `$` inside a string literal
 */
function scanSql(source: string): ScannedSql {
  let code = '';
  const bodies: string[] = [];
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('--', index)) {
      const newline = source.indexOf('\n', index);
      const stop = newline === -1 ? source.length : newline;
      code += blanked(source, index, stop);
      index = stop;
      continue;
    }

    if (source.startsWith('/*', index)) {
      const start = index;
      let depth = 0;
      while (index < source.length) {
        if (source.startsWith('/*', index)) {
          depth += 1;
          index += 2;
        } else if (source.startsWith('*/', index)) {
          depth -= 1;
          index += 2;
          if (depth === 0) break;
        } else {
          index += 1;
        }
      }
      code += blanked(source, start, index);
      continue;
    }

    if (source[index] === "'") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (source[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      code += blanked(source, start, index);
      continue;
    }

    // `$$` or `$tag$`. Requiring the tag shape matters: `{0,2}$` in a regex
    // literal ends with a bare `$` that must not open a quoted body.
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(source.slice(index));
    if (dollar) {
      const tag = dollar[0];
      const start = index;
      const close = source.indexOf(tag, index + tag.length);
      const bodyEnd = close === -1 ? source.length : close;
      bodies.push(source.slice(index + tag.length, bodyEnd));
      index = close === -1 ? source.length : close + tag.length;
      code += blanked(source, start, index);
      continue;
    }

    code += source[index];
    index += 1;
  }

  return { code, bodies };
}

function matchParen(code: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < code.length; index += 1) {
    if (code[index] === '(') depth += 1;
    else if (code[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevel(block: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < block.length; index += 1) {
    const character = block[index];
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(block.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(block.slice(start));
  return parts;
}

/** Table constraints look like column definitions until you read the first word. */
const NOT_A_COLUMN = new Set([
  'primary',
  'unique',
  'foreign',
  'constraint',
  'check',
  'exclude',
  'like',
  'partition',
]);

/**
 * The columns each table actually ends up with.
 *
 * `create table` alone is not the answer, and this repo proves it:
 * `expo_push_token` is still declared in the `profiles` block in
 * `20260801000100_shared_identity.sql` and dropped in
 * `20260802000400_data_protection.sql`. Reading only the create would report a
 * live column that has not existed for two migrations — and the tempting fix
 * would be to allowlist the one column CLAUDE.md says must never come back.
 */
function effectiveColumns(): Map<string, string[]> {
  const tables = new Map<string, string[]>();

  for (const file of migrationFiles) {
    const { code } = scanSql(readFileSync(file, 'utf8'));

    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(/gi;
    for (let match = create.exec(code); match !== null; match = create.exec(code)) {
      const open = code.indexOf('(', match.index + match[0].length - 1);
      const close = matchParen(code, open);
      if (close === -1) continue;

      const columns: string[] = [];
      for (const item of splitTopLevel(code.slice(open + 1, close))) {
        const first = item.trim().split(/\s+/)[0]?.toLowerCase();
        if (first && !NOT_A_COLUMN.has(first)) columns.push(first);
      }
      tables.set(match[1]!.toLowerCase(), columns);
    }

    const added =
      /alter\s+table\s+(?:only\s+)?public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)/gi;
    for (let match = added.exec(code); match !== null; match = added.exec(code)) {
      tables.get(match[1]!.toLowerCase())?.push(match[2]!.toLowerCase());
    }

    const dropped =
      /alter\s+table\s+(?:only\s+)?public\.(\w+)\s+drop\s+column\s+(?:if\s+exists\s+)?(\w+)/gi;
    for (let match = dropped.exec(code); match !== null; match = dropped.exec(code)) {
      const columns = tables.get(match[1]!.toLowerCase());
      if (!columns) continue;
      tables.set(
        match[1]!.toLowerCase(),
        columns.filter((column) => column !== match![2]!.toLowerCase()),
      );
    }
  }

  return tables;
}

const TABLES = effectiveColumns();

// ------------------------------------------------------------ typescript scan

/**
 * Blank comments, keeping strings — `.from('plans')` is how a write is tied to
 * its table, so the table name has to survive.
 */
function withoutComments(source: string): string {
  let out = '';
  let index = 0;

  while (index < source.length) {
    if (source.startsWith('//', index)) {
      const newline = source.indexOf('\n', index);
      const stop = newline === -1 ? source.length : newline;
      out += blanked(source, index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('/*', index)) {
      const close = source.indexOf('*/', index + 2);
      const stop = close === -1 ? source.length : close + 2;
      out += blanked(source, index, stop);
      index = stop;
      continue;
    }
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      const quote = source[index]!;
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === '\\') {
          index += 2;
          continue;
        }
        if (source[index] === quote) {
          index += 1;
          break;
        }
        index += 1;
      }
      out += source.slice(start, index);
      continue;
    }
    out += source[index];
    index += 1;
  }

  return out;
}

/** As above, but string *contents* go too, so brace matching cannot be misled. */
function withoutCommentsOrStrings(source: string): string {
  const noComments = withoutComments(source);
  let out = '';
  let index = 0;

  while (index < noComments.length) {
    const character = noComments[index]!;
    if (character === "'" || character === '"' || character === '`') {
      const start = index;
      index += 1;
      while (index < noComments.length) {
        if (noComments[index] === '\\') {
          index += 2;
          continue;
        }
        if (noComments[index] === character) {
          index += 1;
          break;
        }
        index += 1;
      }
      out += character + blanked(noComments, start + 1, index - 1) + character;
      continue;
    }
    out += character;
    index += 1;
  }

  return out;
}

function matchBrace(code: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Keys at depth 1 of one object literal, and nothing deeper.
 *
 * Depth-1-only is required, not a shortcut: `createPlan` passes
 * `cipher.seal({ title, notes, location }, ...)` as the *value* of `payload`,
 * and a depth-agnostic scan would report `notes` as a plaintext write on the
 * one line that proves it is not.
 */
function keysAtTopLevel(objectSource: string): string[] {
  const keys: string[] = [];
  let depth = 0;

  for (let index = 0; index < objectSource.length; index += 1) {
    const character = objectSource[index]!;

    if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')') depth -= 1;

    if (depth !== 1) continue;

    // `...(condition ? { a } : {})` — this codebase's own conditional-write
    // idiom, and the one place a real key legitimately sits below depth 1.
    if (objectSource.startsWith('...', index)) {
      const open = objectSource.indexOf('(', index);
      const close = open === -1 ? -1 : matchParen(objectSource, open);
      if (close !== -1) {
        const region = objectSource.slice(open, close);
        for (let scan = 0; scan < region.length; scan += 1) {
          if (region[scan] !== '{') continue;
          const end = matchBrace(region, scan);
          if (end === -1) break;
          keys.push(...keysAtTopLevel(region.slice(scan, end + 1)));
          scan = end;
        }
        index = close;
        continue;
      }
    }

    // A key is the first token after `{` or `,` — checked against the previous
    // *non-whitespace* character rather than the previous character.
    //
    // Both halves of that matter. Without the position check, the `:` of a
    // ternary reads as a key separator and `? null : cipher.seal(...)` reports
    // a column called `null`. Without accepting `,` and `}` as terminators,
    // shorthand (`{ enabled }`, and equally `{ notes }`) is not seen at all.
    let previous = index - 1;
    while (previous >= 0 && /\s/.test(objectSource[previous]!)) previous -= 1;
    const after = objectSource[previous];
    if (after !== '{' && after !== ',') continue;

    const key = /^(\w+)\s*[:,}]/.exec(objectSource.slice(index));
    if (key) keys.push(key[1]!);
  }

  return keys;
}

interface Write {
  file: string;
  table: string | null;
  keys: string[];
}

function writesIn(file: string): Write[] {
  const source = readFileSync(file, 'utf8');
  const withStrings = withoutComments(source);
  const structural = withoutCommentsOrStrings(source);

  const writes: Write[] = [];
  const call = /\.(insert|upsert|update)\s*\(/g;

  for (let match = call.exec(structural); match !== null; match = call.exec(structural)) {
    // The table is whichever `.from('x')` most recently preceded this call.
    let table: string | null = null;
    const from = /\.from\(\s*'([a-z_]+)'\s*\)/g;
    for (let f = from.exec(withStrings); f !== null; f = from.exec(withStrings)) {
      if (f.index < match.index) table = f[1]!;
      else break;
    }

    const open = match.index + match[0].length - 1;
    const close = matchParen(structural, open);
    if (close === -1) continue;

    // The first argument only, so `.upsert(row, { onConflict })` does not
    // report `onConflict` as a column.
    const args = structural.slice(open + 1, close);
    const brace = args.indexOf('{');
    if (brace === -1) continue;
    const end = matchBrace(args, brace);
    if (end === -1) continue;

    writes.push({ file, table, keys: keysAtTopLevel(args.slice(brace, end + 1)) });
  }

  return writes;
}

const WRITES = dataFiles.flatMap(writesIn);

// --------------------------------------------------------------------- rules

describe('the schema holds no plaintext content', () => {
  it('defines no column that is not on the allowlist', () => {
    const offenders: string[] = [];
    for (const [table, columns] of TABLES) {
      const allowed = ALLOWED_COLUMNS[table];
      if (!allowed) continue; // reported by the next test
      for (const column of columns) {
        if (!allowed.includes(column)) offenders.push(`${table}.${column}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('defines no table that is not on the allowlist', () => {
    // Without this, a whole new `moods` table would be invisible to the rule
    // above, which only checks tables it already knows.
    const offenders = [...TABLES.keys()].filter((table) => !ALLOWED_COLUMNS[table]);
    expect(offenders).toEqual([]);
  });

  it('has no allowlist entry that no longer exists', () => {
    const offenders: string[] = [];
    for (const [table, allowed] of Object.entries(ALLOWED_COLUMNS)) {
      const columns = TABLES.get(table);
      if (!columns) {
        offenders.push(`${table} (no such table)`);
        continue;
      }
      for (const column of allowed) {
        if (!columns.includes(column)) offenders.push(`${table}.${column}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('hides no column addition inside a function body', () => {
    const offenders: string[] = [];
    for (const file of migrationFiles) {
      for (const body of scanSql(readFileSync(file, 'utf8')).bodies) {
        if (/alter\s+table\s+\S+\s+add\s+column/i.test(body)) {
          offenders.push(relative(REPO_ROOT, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('packages/data writes only real columns', () => {
  it('resolves every write to a table', () => {
    const offenders = WRITES.filter((write) => write.table === null).map((write) =>
      relative(REPO_ROOT, write.file),
    );
    expect(offenders).toEqual([]);
  });

  it('sends no key that is not a column of the table it is sent to', () => {
    const offenders: string[] = [];

    for (const write of WRITES) {
      if (!write.table) continue;
      const allowed = ALLOWED_COLUMNS[write.table];
      if (!allowed) {
        offenders.push(`${relative(REPO_ROOT, write.file)}: unknown table ${write.table}`);
        continue;
      }
      for (const key of write.keys) {
        if (!allowed.includes(key)) {
          offenders.push(`${relative(REPO_ROOT, write.file)}: ${write.table}.${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('packages/crypto stays runtime-free', () => {
  /**
   * An allowlist rather than a list of banned runtimes: `import { Platform }
   * from 'react-native'` is caught, and so is a well-meaning `import { Buffer }
   * from 'buffer'`, which would work under Node and fail on device — the exact
   * failure the hand-written codecs exist to prevent.
   */
  const ALLOWED_IMPORT = (specifier: string): boolean =>
    specifier.startsWith('.') ||
    specifier === 'vitest' ||
    specifier.startsWith('@noble/') ||
    specifier === '@couple/core';

  it('imports nothing that ties it to a runtime', () => {
    const offenders: string[] = [];
    const patterns = [
      /\bfrom\s*['"]([^'"]+)['"]/g,
      /\bimport\s*['"]([^'"]+)['"]/g,
      /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];

    for (const file of cryptoFiles) {
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const pattern of patterns) {
        for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
          if (!ALLOWED_IMPORT(match[1]!)) {
            offenders.push(`${relative(REPO_ROOT, file)}: ${match[1]}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe('the scanners found something', () => {
  /**
   * A parser bug that matched nothing would make every rule above pass
   * unconditionally, which is the failure mode `ai-optional.test.ts` guards
   * against for the same reason.
   */
  it('read the migrations, the data layer, and the crypto package', () => {
    expect(migrationFiles.length).toBeGreaterThan(0);
    expect(dataFiles.length).toBeGreaterThan(0);
    expect(cryptoFiles.length).toBeGreaterThan(0);
  });

  it('parsed the tables it should have', () => {
    expect(TABLES.size).toBeGreaterThanOrEqual(10);
    expect([...TABLES.keys()]).toContain('plans');
    expect([...TABLES.keys()]).toContain('couple_key_wraps');
  });

  it('found the writes it should have', () => {
    // Four modules write today: plans/cadences/proposals, check-ins, ideas,
    // profiles. If this drops to zero the rule above is asserting nothing.
    expect(WRITES.length).toBeGreaterThanOrEqual(8);
    expect(WRITES.map((write) => write.table)).toContain('plans');
    expect(WRITES.map((write) => write.table)).toContain('checkins');
  });

  it('sees through the traps that defeat a regex', () => {
    // `expo_push_token` is declared in one migration and dropped in another;
    // reading only `create table` would report it as live.
    expect(TABLES.get('profiles')).not.toContain('expo_push_token');
    expect(TABLES.get('profiles')).toContain('name_payload');

    // `device_keys.public_key` has a CHECK whose regex contains parens, commas
    // and a `$`. Mis-parsing it mangles the whole column list.
    expect(TABLES.get('device_keys')).toEqual(['id', 'profile_id', 'public_key', 'created_at']);

    // `createPlan` seals `{ title, notes, location }` as the value of
    // `payload`. Those must not be reported as plaintext writes.
    const planWrites = WRITES.filter((write) => write.table === 'plans');
    expect(planWrites.flatMap((write) => write.keys)).toContain('payload');
    expect(planWrites.flatMap((write) => write.keys)).not.toContain('notes');
  });
});
