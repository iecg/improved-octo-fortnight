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
import { describe, expect, it } from 'vitest';

import { createBusyRepository } from './busy';
import { toPlan } from './mappers';
import { createPlanQueries } from './plan-queries';
import { createDomainRepository } from './repository';
import { fakeCipher } from './testing/fake-cipher';
import { fakeClient, filtersOn, payloadOf, tablesTouched } from './testing/fake-client';

const intimacyCipher = fakeCipher('intimacy');

function sealedPlan(fields: Record<string, unknown>, coupleId: string, id: string): string {
  return intimacyCipher.seal(fields, { table: 'plans', coupleId, id });
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
    // factory, so the 2-2-2 app has nothing to import by accident. The same
    // goes for places, which are 2-2-2-owned in the other direction.
    expect(tablesTouched(calls)).not.toContain('checkins');
    expect(tablesTouched(calls)).not.toContain('plan_places');
  });
});

/**
 * The one accessor that reads across the boundary, and why that is allowed.
 *
 * `createBusyRepository` deliberately sees both apps' plans. It is safe only
 * because of what it *cannot* see: the view behind it selects three columns,
 * so there is no domain to filter, no title to leak, and no parameter anyone
 * could add later to widen it. These tests pin that shape — if someone ever
 * points this factory at `plans` to "save a migration", the redaction becomes
 * a client-side promise instead of a Postgres one, and this fails.
 */
describe('the busy-times repository', () => {
  const BUSY_ROW = {
    couple_id: 'couple-1',
    starts_at: '2026-09-12T18:00:00.000Z',
    ends_at: '2026-09-12T20:00:00.000Z',
  };

  const FROM = new Date('2026-09-01T00:00:00.000Z');
  const TO = new Date('2026-09-30T00:00:00.000Z');

  it('reads the redacted view and never the plans table', async () => {
    const { client, calls } = fakeClient([BUSY_ROW]);

    await createBusyRepository(client).listBetween('couple-1', FROM, TO);

    const tables = calls.filter((call) => call.method === 'from').map((call) => call.args[0]);
    expect(tables).toEqual(['plan_busy_times']);
    expect(tables).not.toContain('plans');
  });

  it('never filters on a domain, because the view has none to filter', async () => {
    const { client, calls } = fakeClient([BUSY_ROW]);

    await createBusyRepository(client).listBetween('couple-1', FROM, TO);

    expect(filtersOn(calls, 'couple_id', 'couple-1')).toBe(true);
    expect(calls.some((call) => call.method === 'eq' && call.args[0] === 'domain')).toBe(false);
  });

  it('bounds the read by overlap, so a span containing the window still counts', async () => {
    const { client, calls } = fakeClient([BUSY_ROW]);

    await createBusyRepository(client).listBetween('couple-1', FROM, TO);

    // starts before the window ends, and ends after it begins — a getaway
    // straddling the whole range has neither endpoint inside it.
    expect(calls).toContainEqual({ method: 'lt', args: ['starts_at', TO.toISOString()] });
    expect(calls).toContainEqual({ method: 'gt', args: ['ends_at', FROM.toISOString()] });
  });

  it('returns instants rather than strings, ready for the cadence engine', async () => {
    const { client } = fakeClient([BUSY_ROW]);

    const windows = await createBusyRepository(client).listBetween('couple-1', FROM, TO);

    expect(windows).toEqual([
      { start: new Date('2026-09-12T18:00:00.000Z'), end: new Date('2026-09-12T20:00:00.000Z') },
    ]);
  });

  it('survives an empty result', async () => {
    const { client } = fakeClient(null);
    expect(await createBusyRepository(client).listBetween('couple-1', FROM, TO)).toEqual([]);
  });
});

/**
 * The same boundary, one layer up.
 *
 * `createPlanQueries` hoists the plan and cadence hooks both apps run, and it
 * introduces a second way for one app to end up holding the other's rows: a
 * shared react-query cache key. PostgREST would still be asked the right
 * question, and the answer would still be filtered — but the second app to ask
 * would be served the first one's list out of the cache and never make the
 * request at all.
 *
 * The keys are a plain object, so this needs no React and no renderer. The
 * factory takes a repository rather than a domain precisely so that these keys
 * and that filter cannot disagree; this is the assertion that they don't.
 */
describe('the shared plan queries key their cache by domain', () => {
  const intimacy = createPlanQueries(
    createDomainRepository(fakeClient([]).client, 'intimacy', fakeCipher('intimacy')),
    [],
  );
  const twoTwoTwo = createPlanQueries(
    createDomainRepository(fakeClient([]).client, 'two_two_two', fakeCipher('two_two_two')),
    [],
  );

  it.each(['plans', 'cadences'] as const)('gives the two apps different %s keys', (key) => {
    expect(intimacy.keys[key]('couple-1')).not.toEqual(twoTwoTwo.keys[key]('couple-1'));
  });

  it('gives the two apps different single-plan keys', () => {
    expect(intimacy.keys.plan('plan-1')).not.toEqual(twoTwoTwo.keys.plan('plan-1'));
  });

  /**
   * Busy times are the deliberate exception, and the shape of the exception is
   * the point: `plan_busy_times` has no domain to filter on, so both apps read
   * the identical list and there is nothing for a separate cache to protect.
   */
  it('shares the busy-times key, because both apps read the same view', () => {
    expect(intimacy.keys.busy('couple-1', 'a', 'b')).toEqual(
      twoTwoTwo.keys.busy('couple-1', 'a', 'b'),
    );
    expect(intimacy.keys.busyAll('couple-1')).toEqual(twoTwoTwo.keys.busyAll('couple-1'));
  });

  /** `busyAll` has to be a prefix of `busy`, or invalidating it reaches nothing. */
  it('keys every bounds pair under the prefix that invalidates them all', () => {
    const all = intimacy.keys.busyAll('couple-1');
    expect(intimacy.keys.busy('couple-1', 'a', 'b').slice(0, all.length)).toEqual(all);
  });
});
