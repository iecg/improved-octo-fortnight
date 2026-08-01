/**
 * Test harness for the row-level-security suite.
 *
 * Builds a throwaway database from the shim plus the real migration files, so
 * the policies under test are exactly the ones that ship. Statements run as
 * the `authenticated` role with a JWT subject claim set, which is what makes
 * RLS apply — as superuser or table owner it would be silently bypassed and
 * every test would pass for the wrong reason.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Pool, type PoolClient } from 'pg';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const SHIM = join(REPO_ROOT, 'tests', 'rls', 'supabase-shim.sql');

/**
 * Discrete connection fields rather than a URL: the local socket form
 * (`postgresql://postgres@/db?host=/tmp`) is not parseable by WHATWG `URL`,
 * and these map directly onto the standard `PG*` variables that CI's Postgres
 * service already sets.
 */
const CONNECTION = {
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 55432),
  user: process.env.PGUSER ?? 'postgres',
  ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {}),
};

const ADMIN_DB = process.env.PGDATABASE ?? 'postgres';
const TEST_DB = process.env.RLS_TEST_DB ?? 'apptest_rls';

export async function createTestDatabase(): Promise<Pool> {
  const admin = new Client({ ...CONNECTION, database: ADMIN_DB });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();

  const setup = new Client({ ...CONNECTION, database: TEST_DB });
  await setup.connect();
  await setup.query(readFileSync(SHIM, 'utf8'));
  for (const file of readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    await setup.query(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await setup.end();

  return new Pool({ ...CONNECTION, database: TEST_DB, max: 4 });
}

/** Create an auth user directly, the way Supabase Auth would. */
export async function createUser(pool: Pool, email: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    'insert into auth.users (email) values ($1) returning id',
    [email],
  );
  return rows[0]!.id;
}

/**
 * Run statements as a signed-in user. `set local role` plus the subject claim
 * is what `auth.uid()` reads, so this is as close to a real request as the
 * shim gets.
 */
export async function asUser<T>(
  pool: Pool,
  userId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role authenticated');
    await client.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', userId]);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Same, but as a signed-out visitor. */
export async function asAnon<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('set local role anon');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Assert that a statement is refused, and return the error for inspection.
 *
 * Note that RLS refuses reads by returning zero rows rather than by raising —
 * tests for reads assert on row count, and this helper is for writes.
 */
export async function expectRejected(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected the statement to be rejected, but it succeeded');
}
