/**
 * The domain boundary between the two apps.
 *
 * Row-level security cannot enforce this — both partners are legitimate
 * members of the couple, so the database has no basis to hide intimacy rows
 * from the 2-2-2 app. It holds only because every query in `repository.ts`
 * filters on the domain and every write stamps it, which is exactly what these
 * tests check.
 *
 * The fake client records the fluent calls the repository makes, so a query
 * that silently drops its domain filter fails here rather than in production
 * as one app showing the other's data.
 */
import type { FieldCipher, RecordIdentity } from '@couple/crypto';
import { describe, expect, it } from 'vitest';

import type { AppSupabaseClient } from './client';
import { toPlan } from './mappers';
import { createDomainRepository } from './repository';

/**
 * A cipher that does not encrypt.
 *
 * These tests are about the domain boundary, not about the crypto — that has
 * its own suite in `packages/crypto`. Sealing here is a JSON string tagged with
 * the scope, so a payload sealed by the wrong cipher still fails to open and
 * the boundary tests keep their meaning.
 */
function fakeCipher(scope: FieldCipher['scope']): FieldCipher {
  let counter = 0;
  return {
    scope,
    seal: (fields, identity) => JSON.stringify({ scope, identity, fields }),
    open(blob, identity: RecordIdentity) {
      const parsed = JSON.parse(blob) as {
        scope: string;
        identity: RecordIdentity;
        fields: Record<string, unknown>;
      };
      if (parsed.scope !== scope) throw new Error('wrong scope');
      if (JSON.stringify(parsed.identity) !== JSON.stringify(identity))
        throw new Error('wrong row');
      return parsed.fields;
    },
    newId: () => `generated-${(counter += 1)}`,
  };
}

const intimacyCipher = fakeCipher('intimacy');

function sealedPlan(fields: Record<string, unknown>, coupleId: string, id: string): string {
  return intimacyCipher.seal(fields, { table: 'plans', coupleId, id });
}

interface RecordedCall {
  method: string;
  args: unknown[];
}

function fakeClient(result: unknown): { client: AppSupabaseClient; calls: RecordedCall[] } {
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
function filtersOn(calls: RecordedCall[], column: string, value: unknown): boolean {
  return calls.some(
    (call) => call.method === 'eq' && call.args[0] === column && call.args[1] === value,
  );
}

function payloadOf(calls: RecordedCall[], method: 'insert' | 'upsert' | 'update'): any {
  return calls.find((call) => call.method === method)?.args[0];
}

const PLAN_ROW = {
  id: 'plan-1',
  couple_id: 'couple-1',
  domain: 'intimacy',
  kind: 'intimacy',
  payload: sealedPlan({ title: null, notes: null, location: null }, 'couple-1', 'plan-1'),
  starts_at: null,
  ends_at: null,
  status: 'idea',
  created_by: 'profile-1',
  completed_at: null,
  calendar_event_ids: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const CADENCE_ROW = {
  id: 'cadence-1',
  couple_id: 'couple-1',
  domain: 'intimacy',
  kind: 'intimacy',
  interval_value: 1,
  interval_unit: 'week',
  enabled: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** The domain object the repository hands back, for the methods that take one. */
const PLAN = toPlan(PLAN_ROW as Parameters<typeof toPlan>[0], intimacyCipher);

describe('every read is scoped to the repository domain', () => {
  it('filters plans', async () => {
    const { client, calls } = fakeClient([PLAN_ROW]);
    await createDomainRepository(client, 'intimacy', intimacyCipher).listPlans('couple-1');

    expect(filtersOn(calls, 'domain', 'intimacy')).toBe(true);
    expect(filtersOn(calls, 'couple_id', 'couple-1')).toBe(true);
  });

  it('filters a single plan lookup, so an id from elsewhere resolves to nothing', async () => {
    const { client, calls } = fakeClient(PLAN_ROW);
    await createDomainRepository(client, 'two_two_two', fakeCipher('two_two_two')).getPlan(
      'plan-1',
    );

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
  });

  it('filters cadences', async () => {
    const { client, calls } = fakeClient([CADENCE_ROW]);
    await createDomainRepository(client, 'intimacy', intimacyCipher).listCadences('couple-1');

    expect(filtersOn(calls, 'domain', 'intimacy')).toBe(true);
  });

  it('filters proposals through the joined plan', async () => {
    const { client, calls } = fakeClient([]);
    await createDomainRepository(client, 'intimacy', intimacyCipher).listPendingProposals(
      'couple-1',
    );

    // plan_proposals has no domain column of its own; the constraint rides on
    // an inner join to plans.
    expect(filtersOn(calls, 'plans.domain', 'intimacy')).toBe(true);
  });
});

describe('every write is stamped with the repository domain', () => {
  it('stamps a created plan', async () => {
    const { client, calls } = fakeClient(PLAN_ROW);
    await createDomainRepository(client, 'intimacy', intimacyCipher).createPlan({
      coupleId: 'couple-1',
      kind: 'intimacy',
      createdBy: 'profile-1',
    });

    expect(payloadOf(calls, 'insert').domain).toBe('intimacy');
  });

  it('stamps an upserted cadence', async () => {
    const { client, calls } = fakeClient(CADENCE_ROW);
    await createDomainRepository(client, 'two_two_two', fakeCipher('two_two_two')).upsertCadence({
      coupleId: 'couple-1',
      kind: 'date_night',
      intervalValue: 2,
      intervalUnit: 'week',
    });

    expect(payloadOf(calls, 'upsert').domain).toBe('two_two_two');
  });

  it.each([
    [
      'updatePlanContent',
      (repo: ReturnType<typeof createDomainRepository>) =>
        repo.updatePlanContent(PLAN, { title: 'x' }),
    ],
    [
      'setPlanStatus',
      (repo: ReturnType<typeof createDomainRepository>) =>
        repo.setPlanStatus('plan-1', 'completed'),
    ],
    ['deletePlan', (repo: ReturnType<typeof createDomainRepository>) => repo.deletePlan('plan-1')],
    [
      'setCadenceEnabled',
      (repo: ReturnType<typeof createDomainRepository>) =>
        repo.setCadenceEnabled('cadence-1', false),
    ],
  ])('scopes %s to the domain', async (_name, run) => {
    const { client, calls } = fakeClient(PLAN_ROW);
    await run(createDomainRepository(client, 'intimacy', intimacyCipher));

    expect(filtersOn(calls, 'domain', 'intimacy')).toBe(true);
  });

  it('merges calendar event ids rather than replacing the map', async () => {
    const { client, calls } = fakeClient(PLAN_ROW);
    const repo = createDomainRepository(client, 'intimacy', intimacyCipher);

    await repo.recordCalendarEvent(
      { ...PLAN_ROW, calendarEventIds: { 'profile-1': 'event-a' } } as never,
      'profile-2',
      'event-b',
    );

    // Each partner's phone returns its own id for the same logical event, so
    // one writing must not erase the other's.
    expect(payloadOf(calls, 'update').calendar_event_ids).toEqual({
      'profile-1': 'event-a',
      'profile-2': 'event-b',
    });
  });

  it("removes only the departing partner's calendar id", async () => {
    const { client, calls } = fakeClient(PLAN_ROW);
    const repo = createDomainRepository(client, 'intimacy', intimacyCipher);

    await repo.recordCalendarEvent(
      {
        ...PLAN_ROW,
        calendarEventIds: { 'profile-1': 'event-a', 'profile-2': 'event-b' },
      } as never,
      'profile-2',
      null,
    );

    expect(payloadOf(calls, 'update').calendar_event_ids).toEqual({ 'profile-1': 'event-a' });
  });

  it('clears the completion timestamp when a plan stops being complete', async () => {
    const { client, calls } = fakeClient(PLAN_ROW);
    await createDomainRepository(client, 'intimacy', intimacyCipher).setPlanStatus(
      'plan-1',
      'skipped',
    );

    // A stale completed_at would keep anchoring the cadence to something that
    // did not happen.
    expect(payloadOf(calls, 'update').completed_at).toBeNull();
  });
});

describe('the two apps cannot see each other', () => {
  it('uses a different filter per domain for the same query', async () => {
    const intimacy = fakeClient([PLAN_ROW]);
    const twoTwoTwo = fakeClient([PLAN_ROW]);

    await createDomainRepository(intimacy.client, 'intimacy', intimacyCipher).listPlans('couple-1');
    await createDomainRepository(
      twoTwoTwo.client,
      'two_two_two',
      fakeCipher('two_two_two'),
    ).listPlans('couple-1');

    expect(filtersOn(intimacy.calls, 'domain', 'intimacy')).toBe(true);
    expect(filtersOn(intimacy.calls, 'domain', 'two_two_two')).toBe(false);
    expect(filtersOn(twoTwoTwo.calls, 'domain', 'two_two_two')).toBe(true);
    expect(filtersOn(twoTwoTwo.calls, 'domain', 'intimacy')).toBe(false);
  });

  it('never touches checkins from the shared repository', async () => {
    const { client, calls } = fakeClient([PLAN_ROW]);
    const repo = createDomainRepository(client, 'two_two_two', fakeCipher('two_two_two'));

    await repo.listPlans('couple-1');
    await repo.listCadences('couple-1');
    await repo.listProposals('couple-1');

    // Check-ins are intimacy-owned and reachable only through their own
    // factory, so the 2-2-2 app has nothing to import by accident.
    const tables = calls.filter((call) => call.method === 'from').map((call) => call.args[0]);
    expect(tables).not.toContain('checkins');
  });
});
