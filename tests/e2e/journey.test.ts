/**
 * The end-to-end path, against a real Postgres.
 *
 * Every other suite in this repo tests a layer in isolation. This one walks
 * the whole journey a couple actually takes — pair, choose languages, propose,
 * accept, reconcile calendars, mark done — against the real migrations, the
 * real RLS policies, the real cadence engine, and the real translation
 * bundles. Nothing here is a fake.
 *
 * What it does NOT cover, and cannot from Node:
 *
 *  - Email OTP delivery. `auth.users` rows are created directly, exactly as
 *    `tests/rls/harness.ts` does; Supabase's auth service is what turns a
 *    magic link into one of these rows, and it does not run here.
 *  - PostgREST. Statements run as the `authenticated` role over a socket
 *    rather than through supabase-js, so this proves the schema and the
 *    policies, not the HTTP layer.
 *  - Writing to a device calendar. `calendarActions` is the pure decision the
 *    device acts on, and that is what is asserted; `expo-calendar` itself
 *    needs a hardware dev build.
 */
import { addInterval, calendarActions, computeCadenceStatus } from '@couple/cadence';
import type { Cadence, Plan } from '@couple/core';
import { toPlan } from '@couple/data';
import { createI18n } from '@couple/i18n';
import { differenceInCalendarDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Pool } from 'pg';

import { asUser, createTestDatabase, createUser } from '../rls/harness';

/** The couple's timezone, deliberately not the host's. */
const TZ = 'America/New_York';

let pool: Pool;
let alice: string;
let bob: string;
let carol: string;

/** Shared across the ordered steps below; each one builds on the last. */
const world: {
  coupleId: string;
  firstCode: string;
  rotatedCode: string;
  planId: string;
  proposalId: string;
  startsAt: string;
  endsAt: string;
  coupleCreatedAt: string;
} = {
  coupleId: '',
  firstCode: '',
  rotatedCode: '',
  planId: '',
  proposalId: '',
  startsAt: '',
  endsAt: '',
  coupleCreatedAt: '',
};

/** Read a plan back as a domain object, through the same mapper the app uses. */
async function readPlans(actor: string): Promise<Plan[]> {
  return asUser(pool, actor, async (client) => {
    const { rows } = await client.query('select * from public.plans order by created_at');
    return rows.map(toPlan);
  });
}

beforeAll(async () => {
  pool = await createTestDatabase();
  alice = await createUser(pool, 'alice@example.test');
  bob = await createUser(pool, 'bob@example.test');
  carol = await createUser(pool, 'carol@example.test');
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

describe('1. sign-in', () => {
  it('gives every new account a profile without the client asking', async () => {
    // The on_auth_user_created trigger is what OTP sign-in relies on: the app
    // never inserts a profile row.
    const profile = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.profiles where id = $1', [alice]);
      return rows[0];
    });

    expect(profile).toBeDefined();
    expect(profile.locale).toBe('en');
    expect(profile.timezone).toBe('UTC');
  });
});

describe('2. pairing', () => {
  it('creates a couple with a code from the CSPRNG alphabet', async () => {
    const couple = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.create_couple($1)', [TZ]);
      return rows[0];
    });

    world.coupleId = couple.id;
    world.firstCode = couple.invite_code;
    world.coupleCreatedAt = couple.created_at.toISOString();

    expect(couple.timezone).toBe(TZ);
    // Eight characters, no I/L/O/U, so it survives being read aloud.
    expect(world.firstCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it('lets the second partner redeem it', async () => {
    const result = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select public.join_couple($1) as r', [world.firstCode]);
      return rows[0].r;
    });

    expect(result).toEqual({ ok: true, couple_id: world.coupleId });
  });

  it('rotates the code once redeemed', async () => {
    const code = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select invite_code from public.couples');
      return rows[0].invite_code;
    });

    world.rotatedCode = code;
    expect(code).not.toBe(world.firstCode);
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);

    // The screenshot in a camera roll is now worthless.
    const replay = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select public.join_couple($1) as r', [world.firstCode]);
      return rows[0].r;
    });
    expect(replay).toEqual({ ok: false, reason: 'invalid_code' });
  });

  it('turns a third person away with couple_full, not an exception', async () => {
    const result = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select public.join_couple($1) as r', [
        world.rotatedCode,
      ]);
      return rows[0].r;
    });

    // A reason code, not a raised English string — Postgres speaks English and
    // one of these two partners does not.
    expect(result).toEqual({ ok: false, reason: 'couple_full' });
  });
});

describe('3. two partners, two languages', () => {
  it('stores locale per person, not per couple', async () => {
    await asUser(pool, alice, (client) =>
      client.query("update public.profiles set locale = 'en', timezone = $1 where id = $2", [
        TZ,
        alice,
      ]),
    );
    await asUser(pool, bob, (client) =>
      client.query("update public.profiles set locale = 'es', timezone = $1 where id = $2", [
        TZ,
        bob,
      ]),
    );

    // Each partner sees both profiles — that is how the app knows the other
    // person reads in another language.
    const seenByBob = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select id, locale from public.profiles order by locale');
      return rows;
    });

    expect(seenByBob).toEqual([
      { id: alice, locale: 'en' },
      { id: bob, locale: 'es' },
    ]);
  });

  it('renders the same row in both languages at the same time', async () => {
    // Two live instances, concurrently — this is the invariant the whole
    // product rests on, so it is asserted with both in memory at once rather
    // than by switching one instance's language.
    const en = createI18n('en');
    const es = createI18n('es');

    expect(en.t('cadence:health.overdue')).toBe("It's been a while");
    expect(es.t('cadence:health.overdue')).toBe('Ha pasado un tiempo');

    // And switching one must not disturb the other.
    expect(en.t('cadence:kind.intimacy.intimacy.label')).toBe('Time together');
    expect(es.t('cadence:kind.intimacy.intimacy.label')).not.toBe('Time together');
  });
});

describe('4. proposing a time', () => {
  /** Written by Alice, in her own words: accents, an em dash, an apostrophe. */
  const NOTE = "I'll bring dessert — ¿a las ocho?";

  it('creates the plan and the proposal', async () => {
    // Mirrors useProposeTime: a `proposed` plan plus a proposal row.
    const start = new Date('2026-09-12T23:00:00.000Z'); // 19:00 in New York
    const end = new Date('2026-09-13T01:00:00.000Z');
    world.startsAt = start.toISOString();
    world.endsAt = end.toISOString();

    const ids = await asUser(pool, alice, async (client) => {
      const { rows: planRows } = await client.query(
        `insert into public.plans
           (couple_id, domain, kind, notes, starts_at, ends_at, status, created_by)
         values ($1, 'intimacy', 'intimacy', $2, $3, $4, 'proposed', $5)
         returning id`,
        [world.coupleId, NOTE, world.startsAt, world.endsAt, alice],
      );
      const { rows: proposalRows } = await client.query(
        `insert into public.plan_proposals
           (plan_id, couple_id, proposed_by, starts_at, ends_at)
         values ($1, $2, $3, $4, $5)
         returning id`,
        [planRows[0].id, world.coupleId, alice, world.startsAt, world.endsAt],
      );
      return { planId: planRows[0].id, proposalId: proposalRows[0].id };
    });

    world.planId = ids.planId;
    world.proposalId = ids.proposalId;
    expect(world.planId).toBeTruthy();
  });

  it('shows Bob the note verbatim, in the language it was written', async () => {
    const [plan] = await readPlans(bob);

    // Byte-identical. Partner-written text is never machine-translated, and
    // Bob reading Spanish does not change what Alice wrote.
    expect(plan!.notes).toBe(NOTE);
  });

  it('translates the chrome around it into Bob’s language', async () => {
    const es = createI18n('es');
    // The status token is stored as an English machine token and rendered
    // through a key; it must not reach Bob as "proposed".
    const [plan] = await readPlans(bob);
    expect(plan!.status).toBe('proposed');
    expect(es.t('cadence:kind.intimacy.intimacy.label')).toBe('Tiempo juntos');
  });

  it('will not let Alice answer her own proposal', async () => {
    await expect(
      asUser(pool, alice, (client) =>
        client.query("update public.plan_proposals set response = 'accepted' where id = $1", [
          world.proposalId,
        ]),
      ),
    ).rejects.toThrow(/answered by the other partner/);
  });
});

describe('5. accepting, and the calendar on both devices', () => {
  it('books the plan when Bob accepts', async () => {
    // Mirrors useRespondToProposal: respond, then move the plan to scheduled.
    await asUser(pool, bob, async (client) => {
      await client.query("update public.plan_proposals set response = 'accepted' where id = $1", [
        world.proposalId,
      ]);
      await client.query(
        "update public.plans set status = 'scheduled', starts_at = $1, ends_at = $2 where id = $3",
        [world.startsAt, world.endsAt, world.planId],
      );
    });

    const proposal = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.plan_proposals where id = $1', [
        world.proposalId,
      ]);
      return rows[0];
    });

    // Stamped by the trigger, not by the client.
    expect(proposal.response).toBe('accepted');
    expect(proposal.responded_by).toBe(bob);
    expect(proposal.responded_at).not.toBeNull();
  });

  it('tells BOTH devices to create an event, including the one that did not tap accept', async () => {
    const plans = await readPlans(alice);

    // This is the reconciliation property. Bob tapped accept; Alice's phone was
    // in her pocket. Both devices independently conclude they owe an event.
    expect(calendarActions(plans, alice).toWrite.map((p) => p.id)).toEqual([world.planId]);
    expect(calendarActions(plans, bob).toWrite.map((p) => p.id)).toEqual([world.planId]);
  });

  it('keeps the two devices’ event ids apart', async () => {
    // Alice's phone writes its event and records the id under her profile.
    await asUser(pool, alice, (client) =>
      client.query(
        `update public.plans
         set calendar_event_ids = calendar_event_ids || jsonb_build_object($1::text, $2::text)
         where id = $3`,
        [alice, 'ALICE-DEVICE-EVENT-1', world.planId],
      ),
    );

    const plans = await readPlans(bob);

    // Alice is now settled; Bob's phone still owes an event and will create it
    // on its own next sync, without Bob having tapped anything.
    expect(calendarActions(plans, alice).toWrite).toEqual([]);
    expect(calendarActions(plans, bob).toWrite.map((p) => p.id)).toEqual([world.planId]);
    expect(plans[0]!.calendarEventIds).toEqual({ [alice]: 'ALICE-DEVICE-EVENT-1' });
  });
});

describe('6. marking it done resets the countdown', () => {
  const cadence: Cadence = {
    id: 'cadence-under-test',
    coupleId: '',
    domain: 'intimacy',
    kind: 'intimacy',
    intervalValue: 1,
    intervalUnit: 'week',
    enabled: true,
  };

  it('moves the anchor to the plan and the due date on by exactly one interval', async () => {
    cadence.coupleId = world.coupleId;
    const now = new Date('2026-09-14T12:00:00.000Z');

    const before = computeCadenceStatus({
      cadence,
      plans: await readPlans(alice),
      now,
      coupleCreatedAt: new Date(world.coupleCreatedAt),
      timeZone: TZ,
    });

    // Nothing completed yet, so the couple's start date is still the anchor.
    expect(before.lastCompletedAt).toBeNull();

    await asUser(pool, alice, (client) =>
      client.query(
        "update public.plans set status = 'completed', completed_at = now() where id = $1",
        [world.planId],
      ),
    );

    const after = computeCadenceStatus({
      cadence,
      plans: await readPlans(alice),
      now,
      coupleCreatedAt: new Date(world.coupleCreatedAt),
      timeZone: TZ,
    });

    const startsAt = new Date(world.startsAt);
    expect(after.lastCompletedAt?.toISOString()).toBe(world.startsAt);
    expect(after.anchorAt.toISOString()).toBe(world.startsAt);
    expect(after.nextDueAt).not.toEqual(before.nextDueAt);

    // Exactly one week later, in wall-clock terms the couple would recognise:
    // seven calendar days on, at the same time of day.
    expect(differenceInCalendarDays(after.nextDueAt, startsAt)).toBe(7);
    expect(formatInTimeZone(after.nextDueAt, TZ, 'HH:mm')).toBe(
      formatInTimeZone(startsAt, TZ, 'HH:mm'),
    );
    expect(after.nextDueAt.getTime()).toBe(addInterval(startsAt, 1, 'week', TZ).getTime());
  });

  it('refuses to leave a stale completed_at behind', async () => {
    // The biconditional: a plan pushed back out of `completed` must lose its
    // timestamp, or the cadence re-anchors to something that never happened.
    await expect(
      asUser(pool, alice, (client) =>
        client.query("update public.plans set status = 'scheduled' where id = $1", [world.planId]),
      ),
    ).rejects.toThrow(/plans_completed_has_timestamp/);
  });
});

describe('7. countering a suggestion', () => {
  let planId = '';
  let original = '';
  let reply = '';

  it('closes the original and chains the reply to it', async () => {
    // Alice suggests a time.
    const created = await asUser(pool, alice, async (client) => {
      const { rows: planRows } = await client.query(
        `insert into public.plans (couple_id, domain, kind, starts_at, ends_at, status, created_by)
         values ($1, 'intimacy', 'intimacy', $2, $3, 'proposed', $4) returning id`,
        [world.coupleId, '2026-10-01T23:00:00.000Z', '2026-10-02T01:00:00.000Z', alice],
      );
      const { rows: proposalRows } = await client.query(
        `insert into public.plan_proposals (plan_id, couple_id, proposed_by, starts_at, ends_at)
         values ($1, $2, $3, $4, $5) returning id`,
        [
          planRows[0].id,
          world.coupleId,
          alice,
          '2026-10-01T23:00:00.000Z',
          '2026-10-02T01:00:00.000Z',
        ],
      );
      return { planId: planRows[0].id, proposalId: proposalRows[0].id };
    });
    planId = created.planId;
    original = created.proposalId;

    // Bob answers with a different time, the way useCounterProposal does.
    reply = await asUser(pool, bob, async (client) => {
      await client.query("update public.plan_proposals set response = 'countered' where id = $1", [
        original,
      ]);
      const { rows } = await client.query(
        `insert into public.plan_proposals
           (plan_id, couple_id, proposed_by, starts_at, ends_at, countered_from)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [
          planId,
          world.coupleId,
          bob,
          '2026-10-02T23:00:00.000Z',
          '2026-10-03T01:00:00.000Z',
          original,
        ],
      );
      return rows[0].id;
    });

    const [first, second, plan] = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select * from public.plan_proposals where id = any($1) order by created_at',
        [[original, reply]],
      );
      const { rows: planRows } = await client.query('select * from public.plans where id = $1', [
        planId,
      ]);
      return [rows[0], rows[1], planRows[0]];
    });

    // "Countered" is a real answer, stamped like any other.
    expect(first.response).toBe('countered');
    expect(first.responded_by).toBe(bob);
    // And the reply points back at what it replies to, on the same plan.
    expect(second.countered_from).toBe(original);
    expect(second.plan_id).toBe(planId);
    expect(second.proposed_by).toBe(bob);
    // Nothing is booked, and nothing was declined.
    expect(plan.status).toBe('proposed');
  });

  it('will not let Bob accept the counter he just wrote', async () => {
    // The guard travels with authorship, not with who proposed first: Bob now
    // owns this suggestion, so answering it is Alice's to do.
    await expect(
      asUser(pool, bob, (client) =>
        client.query("update public.plan_proposals set response = 'accepted' where id = $1", [
          reply,
        ]),
      ),
    ).rejects.toThrow(/answered by the other partner/);
  });

  it('lets the original proposer accept the counter', async () => {
    // Alice proposed the first one but not this one, so the trigger must let
    // her answer it — otherwise a counter is a dead end.
    await asUser(pool, alice, (client) =>
      client.query("update public.plan_proposals set response = 'accepted' where id = $1", [reply]),
    );

    const accepted = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select * from public.plan_proposals where id = $1', [
        reply,
      ]);
      return rows[0];
    });

    expect(accepted.response).toBe('accepted');
    expect(accepted.responded_by).toBe(alice);
  });

  /**
   * The guard covers the transition out of `pending` — the moment an answer is
   * actually given — and not later edits to an answered row. That is
   * deliberate rather than an oversight: both partners are members with update
   * rights, the plan's own status is what drives the calendar and the cadence,
   * and no rewrite of an answered proposal changes either. Pinned so the
   * boundary is a decision on the record instead of a surprise.
   */
  it('does not re-guard a proposal that has already been answered', async () => {
    await asUser(pool, bob, (client) =>
      client.query("update public.plan_proposals set response = 'declined' where id = $1", [reply]),
    );

    const [row, plan] = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.plan_proposals where id = $1', [
        reply,
      ]);
      const { rows: planRows } = await client.query('select * from public.plans where id = $1', [
        planId,
      ]);
      return [rows[0], planRows[0]];
    });

    expect(row.response).toBe('declined');
    // responded_by still records who actually answered it.
    expect(row.responded_by).toBe(alice);
    // And the plan — the thing that reaches a calendar — is untouched.
    expect(plan.status).toBe('proposed');
  });
});

/**
 * 8. Where it actually is.
 *
 * The 2-2-2 app is the one that answers "where", and it answers it with no
 * mapping provider configured — which is the state every install is in until
 * someone sets a key, and the state this suite runs in. A place typed by hand
 * has to survive the round trip, reach the label a calendar would show, and
 * stay out of that calendar unless somebody asked for it.
 */
describe('8. a place on a 2-2-2 plan', () => {
  let planId = '';
  let placeId = '';

  /** Accented, em-dashed, and in the partner's own language on purpose. */
  const NAME = 'Café Anglès';
  const ADDRESS = 'Carrer dels Almogàvers 1, Barcelona';

  it('books a 2-2-2 date night and attaches a place typed by hand', async () => {
    const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

    [planId, placeId] = await asUser(pool, alice, async (client) => {
      const { rows: planRows } = await client.query<{ id: string }>(
        `insert into public.plans (couple_id, domain, kind, title, location, starts_at, status, created_by)
         values ($1, 'two_two_two', 'date_night', 'dinner', $2, $3, 'scheduled', $4)
         returning id`,
        [world.coupleId, `${NAME} — ${ADDRESS}`, startsAt, alice],
      );
      const { rows: placeRows } = await client.query<{ id: string }>(
        `insert into public.plan_places
           (couple_id, domain, plan_id, name, address, provider, locale, attached_by)
         values ($1, 'two_two_two', $2, $3, $4, 'manual', 'es', $5)
         returning id`,
        [world.coupleId, planRows[0]!.id, NAME, ADDRESS, alice],
      );
      return [planRows[0]!.id, placeRows[0]!.id];
    });

    expect(planId).toBeTruthy();
    expect(placeId).toBeTruthy();
  });

  it('shows Bob the place verbatim, accents and all', async () => {
    const place = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select * from public.plan_places where id = $1', [
        placeId,
      ]);
      return rows[0];
    });

    // Authored text. Byte-identical, never machine-translated — the same
    // property this suite already pins for a proposal's note.
    expect(place.name).toBe(NAME);
    expect(place.address).toBe(ADDRESS);
    // Labelled with the language it was written in, so Bob is told rather than
    // shown a translation.
    expect(place.locale).toBe('es');
    // Nothing was searched, so there is nothing a provider gave us.
    expect(place.provider).toBe('manual');
    expect(place.latitude).toBeNull();
    expect(place.provider_place_id).toBeNull();
  });

  it('keeps the address out of the calendar until someone opts in', async () => {
    const place = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.plan_places where id = $1', [
        placeId,
      ]);
      return rows[0];
    });
    expect(place.share_with_calendar).toBe(false);

    // What the device would do with it. The plan is booked, so an entry is
    // wanted — but the app's own opt-in check is what decides whether the
    // address rides along, and nobody asked.
    const plans = await readPlans(alice);
    const plan = plans.find((candidate) => candidate.id === planId)!;
    const { toWrite } = calendarActions([plan], alice);

    expect(toWrite).toHaveLength(1);
    expect(place.share_with_calendar ? (plan.location ?? undefined) : undefined).toBeUndefined();
  });

  it('lets either partner opt the address in, and then it is the label', async () => {
    await asUser(pool, bob, (client) =>
      client.query('update public.plan_places set share_with_calendar = true where id = $1', [
        placeId,
      ]),
    );

    const [place, plans] = await Promise.all([
      asUser(pool, bob, async (client) => {
        const { rows } = await client.query('select * from public.plan_places where id = $1', [
          placeId,
        ]);
        return rows[0];
      }),
      readPlans(bob),
    ]);
    const plan = plans.find((candidate) => candidate.id === planId)!;

    expect(place.share_with_calendar).toBe(true);
    // plans.location is the column that reaches a calendar entry, and it holds
    // the label rather than a coordinate.
    const written = place.share_with_calendar ? (plan.location ?? undefined) : undefined;
    expect(written).toBe(`${NAME} — ${ADDRESS}`);
    expect(written!.length).toBeLessThanOrEqual(200);
  });

  it('takes the place with it when the plan is deleted', async () => {
    await asUser(pool, alice, (client) =>
      client.query('delete from public.plans where id = $1', [planId]),
    );

    const left = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select id from public.plan_places where id = $1', [
        placeId,
      ]);
      return rows;
    });
    expect(left).toEqual([]);
  });
});
