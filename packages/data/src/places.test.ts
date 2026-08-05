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

import { createPlaceRepository, InvalidPlaceError } from './places';
import { fakeCipher } from './testing/fake-cipher';

const placeCipher = fakeCipher('two_two_two');
import { fakeClient, filtersOn, payloadOf, tablesTouched } from './testing/fake-client';

const PLACE_ROW = {
  id: 'place-1',
  couple_id: 'couple-1',
  domain: 'two_two_two',
  plan_id: 'plan-1',
  idea_id: null,
  payload: placeCipher.seal(
    {
      name: 'Bar Nou',
      address: 'Carrer dels Almogàvers 1, Barcelona',
      providerPlaceId: null,
      latitude: null,
      longitude: null,
      locale: 'es',
    },
    { table: 'plan_places', coupleId: 'couple-1', id: 'place-1' },
  ),
  provider: 'manual',
  share_with_calendar: false,
  attached_by: 'profile-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

/** What the fake cipher sealed, read back so a test can assert on it. */
function sealedFields(payload: string): Record<string, unknown> {
  return (JSON.parse(payload) as { fields: Record<string, unknown> }).fields;
}

describe('every read is scoped to the 2-2-2 domain', () => {
  it('filters the couple listing', async () => {
    const { client, calls } = fakeClient([PLACE_ROW]);
    await createPlaceRepository(client, placeCipher).listForCouple('couple-1');

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
    expect(filtersOn(calls, 'couple_id', 'couple-1')).toBe(true);
  });

  it('filters a lookup by plan, so a plan id from the other app resolves to nothing', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client, placeCipher).getForPlan('plan-1');

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
  });
});

describe('every write is stamped or scoped', () => {
  it('stamps the domain on an attached place', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client, placeCipher).attach({
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
    await run(createPlaceRepository(client, placeCipher));

    expect(filtersOn(calls, 'domain', 'two_two_two')).toBe(true);
  });

  it('never touches a table it does not own', async () => {
    const { client, calls } = fakeClient([PLACE_ROW]);
    const repo = createPlaceRepository(client, placeCipher);

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
    await createPlaceRepository(client, placeCipher).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      planId: 'plan-1',
      name: 'Bar Nou',
      provider: 'manual',
      locale: 'es',
    });

    const row = payloadOf(calls, 'insert');
    // Provenance stays outside; it is which kind of record this is, not where.
    expect(row.provider).toBe('manual');
    // Opt-in, and nobody opted in.
    expect(row.share_with_calendar).toBe(false);

    const sealed = sealedFields(row.payload);
    expect(sealed.name).toBe('Bar Nou');
    expect(sealed.latitude).toBeNull();
    expect(sealed.longitude).toBeNull();
    expect(sealed.providerPlaceId).toBeNull();
  });

  it('sends the venue nowhere the server can read it', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client, placeCipher).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      planId: 'plan-1',
      name: 'Bar Nou',
      address: 'Carrer dels Almogàvers 1, Barcelona',
      provider: 'manual',
      locale: 'es',
    });

    // The whole reason this table was resealed. `tests/guards/
    // no-plaintext-content.test.ts` proves the columns are gone; this proves
    // the repository does not put the words in one of the columns that remain.
    const row = payloadOf(calls, 'insert') as Record<string, unknown>;
    const outside = Object.entries(row).filter(([key]) => key !== 'payload');
    expect(JSON.stringify(outside)).not.toContain('Bar Nou');
    expect(JSON.stringify(outside)).not.toContain('Almogàvers');
  });

  it('refuses a searched place with no handle to find it by again', async () => {
    const { client } = fakeClient(PLACE_ROW);
    // Was `plan_places_google_has_id`, until the column it checked moved
    // inside the payload.
    await expect(
      createPlaceRepository(client, placeCipher).attach({
        coupleId: 'couple-1',
        attachedBy: 'profile-1',
        planId: 'plan-1',
        name: 'Somewhere',
        provider: 'google',
        locale: 'en',
      }),
    ).rejects.toThrow(InvalidPlaceError);
  });

  it('seals a coordinate pair rather than splitting it into two columns', async () => {
    const { client, calls } = fakeClient(PLACE_ROW);
    await createPlaceRepository(client, placeCipher).attach({
      coupleId: 'couple-1',
      attachedBy: 'profile-1',
      ideaId: 'idea-1',
      name: 'Somewhere',
      provider: 'google',
      providerPlaceId: 'abc123',
      coordinates: { latitude: 41.385064, longitude: 2.173404 },
      locale: 'en',
    });

    const row = payloadOf(calls, 'insert');
    const sealed = sealedFields(row.payload);
    expect(sealed.latitude).toBe(41.385064);
    expect(sealed.longitude).toBe(2.173404);
    // The target columns stay readable: the foreign keys need them.
    expect(row.plan_id).toBeNull();
    expect(row.idea_id).toBe('idea-1');
  });
});
