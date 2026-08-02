/**
 * The domain boundary, on the 2-2-2-owned places table.
 *
 * Same reasoning as `repository.test.ts`: RLS cannot hide these rows from the
 * intimacy app, because both partners are legitimate members of the couple. It
 * holds only because every query here filters on the domain and every write
 * stamps it.
 *
 * The other half of the boundary is structural and checked by reading the
 * signature rather than by a test: `createPlaceRepository` takes no domain
 * argument at all.
 */
import { describe, expect, it } from 'vitest';

import { createPlaceRepository } from './places';
import { fakeClient, filtersOn, payloadOf, tablesTouched } from './testing/fake-client';

const PLACE_ROW = {
  id: 'place-1',
  couple_id: 'couple-1',
  domain: 'two_two_two',
  plan_id: 'plan-1',
  idea_id: null,
  name: 'Bar Nou',
  address: 'Carrer dels Almogàvers 1, Barcelona',
  provider: 'manual',
  provider_place_id: null,
  latitude: null,
  longitude: null,
  locale: 'es' as const,
  share_with_calendar: false,
  attached_by: 'profile-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('every read is scoped to the 2-2-2 domain', () => {
  it('filters the couple listing', async () => {
    const { client, calls } = fakeClient([PLACE_ROW]);
    await createPlaceRepository(client).listForCouple('couple-1');

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
    expect(filtersOn(calls, 'couple_id', 'couple-1')).toBe(true);
  });

  it('filters a lookup by plan, so a plan id from the other app resolves to nothing', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client).getForPlan('plan-1');

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
  });
});

describe('every write is stamped or scoped', () => {
  it('stamps the domain on an attached place', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      planId: 'plan-1',
      name: 'Bar Nou',
      provider: 'manual',
      locale: 'es',
    });

    expect(payloadOf(calls, 'insert').domain).toBe('two_two_two');
  });

  it.each([
    ['detach', (repo: ReturnType<typeof createPlaceRepository>) => repo.detach('place-1')],
    [
      'setShareWithCalendar',
      (repo: ReturnType<typeof createPlaceRepository>) =>
        repo.setShareWithCalendar('place-1', true),
    ],
  ])('scopes %s to the domain', async (_name, run) => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await run(createPlaceRepository(client));

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
  });

  it('never touches a table it does not own', async () => {
    const { client, calls } = fakeClient([PLACE_ROW]);
    const repo = createPlaceRepository(client);

    await repo.listForCouple('couple-1');
    await repo.attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      planId: 'plan-1',
      name: 'Bar Nou',
      provider: 'manual',
      locale: 'en',
    });

    // Writing plans.location is the caller's explicit second step, not a side
    // effect hidden in here — that column is what can reach a calendar.
    expect(tablesTouched(calls)).toEqual(['plan_places', 'plan_places']);
  });
});

describe('a place that needs no mapping provider', () => {
  it('stores a typed place with no coordinates and no provider id', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      planId: 'plan-1',
      name: 'Bar Nou',
      provider: 'manual',
      locale: 'es',
    });

    const payload = payloadOf(calls, 'insert');
    expect(payload.provider).toBe('manual');
    expect(payload.latitude).toBeNull();
    expect(payload.longitude).toBeNull();
    expect(payload.provider_place_id).toBeNull();
    // Opt-in, and nobody opted in.
    expect(payload.share_with_calendar).toBe(false);
  });

  it('splits a coordinate pair into its two columns', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      ideaId: 'idea-1',
      name: 'Somewhere',
      provider: 'google',
      providerPlaceId: 'abc123',
      coordinates: { latitude: 41.385064, longitude: 2.173404 },
      locale: 'en',
    });

    const payload = payloadOf(calls, 'insert');
    expect(payload.latitude).toBe(41.385064);
    expect(payload.longitude).toBe(2.173404);
    expect(payload.plan_id).toBeNull();
    expect(payload.idea_id).toBe('idea-1');
  });
});
