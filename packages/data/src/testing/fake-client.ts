/**
 * A Supabase client that records what was asked of it.
 *
 * The domain boundary between the two apps is a query-layer invariant — RLS
 * cannot express it, because both partners are legitimate members of the
 * couple. The only way to check it is to watch the calls a repository makes and
 * assert that every read filters on the domain and every write stamps it.
 *
 * Deliberately not exported from `src/index.ts`: this is test scaffolding, and
 * the thing it fakes is the raw table client that invariant 2 forbids shipping.
 */
import type { AppSupabaseClient } from '../client';

export interface RecordedCall {
  method: string;
  args: unknown[];
}

export function fakeClient(result: unknown): { client: AppSupabaseClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const builder: any = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        // Thenable, so `await` on the builder resolves like a PostgREST call.
        if (property === 'then') {
          return (resolve: (value: unknown) => unknown) => resolve({ data: result, error: null });
        }
        return (...args: unknown[]) => {
          calls.push({ method: property, args });
          return builder;
        };
      },
    },
  );

  const client = {
    from(table: string) {
      calls.push({ method: 'from', args: [table] });
      return builder;
    },
  } as unknown as AppSupabaseClient;

  return { client, calls };
}

/** Did the query constrain `column` to `value`? */
export function filtersOn(calls: RecordedCall[], column: string, value: unknown): boolean {
  return calls.some(
    (call) => call.method === 'eq' && call.args[0] === column && call.args[1] === value,
  );
}

export function payloadOf(calls: RecordedCall[], method: 'insert' | 'upsert' | 'update'): any {
  return calls.find((call) => call.method === method)?.args[0];
}

/** Which tables the query touched, in call order. */
export function tablesTouched(calls: RecordedCall[]): unknown[] {
  return calls.filter((call) => call.method === 'from').map((call) => call.args[0]);
}
