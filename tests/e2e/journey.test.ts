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
import { DISPLAY_NAME_MAX, displayNameLength, type Cadence, type Plan } from '@couple/core';
import { toPlan, toPlanPlace, toProfile } from '@couple/data';
import { createI18n } from '@couple/i18n';
import { differenceInCalendarDays } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import type { Pool } from 'pg';

import {
  generateCoupleRootKey,
  generateDeviceKeypair,
  generateRecoveryCode,
  safetyNumber,
  toBase64,
  unwrapCoupleKey,
  unwrapWithRecoveryCode,
  wrapCoupleKey,
  wrapWithRecoveryCode,
  type CoupleRootKey,
  type FieldCipher,
  type ScryptParams,
} from '@couple/crypto';

import { cipherWithKey, testRandom } from '../support/crypto';
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

/**
 * Each device's own key material — separate on purpose. Alice's device and
 * Bob's device derive their content keys independently, and a test that shared
 * one cipher between them would prove nothing about the exchange.
 */
const devices: Record<
  string,
  { keypair: ReturnType<typeof generateDeviceKeypair>; cipher?: FieldCipher }
> = {};

/** The couple key itself, minted in 2b and re-checked when a third device joins. */
let coupleRoot: CoupleRootKey;

/**
 * Written by Alice in step 4, in her own words: accents, an em dash, an
 * apostrophe. Module-scoped rather than local to that step because step 8
 * reads the same row back through a key that arrived a different way, and the
 * whole assertion is that it says the same thing.
 */
const NOTE = "I'll bring dessert — ¿a las ocho?";

function cipherOf(actor: string): FieldCipher {
  const cipher = devices[actor]?.cipher;
  if (!cipher) throw new Error(`${actor}'s device has no couple key yet`);
  return cipher;
}

/** Read a plan back as a domain object, through the same mapper the app uses. */
async function readPlans(actor: string): Promise<Plan[]> {
  return asUser(pool, actor, async (client) => {
    const { rows } = await client.query('select * from public.plans order by created_at');
    return rows.map((row) => toPlan(row, cipherOf(actor)));
  });
}

function sealPlanFor(actor: string, id: string, fields: Record<string, unknown>): string {
  return cipherOf(actor).seal(fields, { table: 'plans', coupleId: world.coupleId, id });
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

/**
 * The key exchange, walked for real.
 *
 * Both devices publish a public key through RLS, both compute the safety number
 * independently from what each can actually see, Alice wraps and Bob unwraps.
 * Nothing is shared between them but the rows in the database — which is
 * exactly the position a malicious server would be in.
 */
describe('2b. exchanging keys', () => {
  it('lets each device publish its own public key, and only its own', async () => {
    for (const actor of [alice, bob]) {
      devices[actor] = { keypair: generateDeviceKeypair(testRandom) };
      await asUser(pool, actor, (client) =>
        client.query('insert into public.device_keys (profile_id, public_key) values ($1, $2)', [
          actor,
          toBase64(devices[actor]!.keypair.publicKey),
        ]),
      );
    }

    // Publishing as your partner is refused: a device key is a claim about
    // whose device it is.
    await expect(
      asUser(pool, alice, (client) =>
        client.query('insert into public.device_keys (profile_id, public_key) values ($1, $2)', [
          bob,
          toBase64(devices[alice]!.keypair.publicKey),
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('shows both partners the same safety number', async () => {
    const partnerKey = async (actor: string, partner: string): Promise<Uint8Array> =>
      asUser(pool, actor, async (client) => {
        const { rows } = await client.query(
          'select public_key from public.device_keys where profile_id = $1',
          [partner],
        );
        return new Uint8Array(Buffer.from(rows[0].public_key as string, 'base64'));
      });

    // Each side computes from its own key plus what the database served it.
    // A server substituting a key of its own would make these two differ, and
    // the two people comparing them out loud is what catches it.
    const aliceSees = safetyNumber(
      devices[alice]!.keypair.publicKey,
      await partnerKey(alice, bob),
      world.coupleId,
    );
    const bobSees = safetyNumber(
      await partnerKey(bob, alice),
      devices[bob]!.keypair.publicKey,
      world.coupleId,
    );

    expect(aliceSees).toBe(bobSees);
    expect(aliceSees).toMatch(
      /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}(-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}){2}$/,
    );
  });

  it('hands the couple key from one device to the other', async () => {
    const root = generateCoupleRootKey(testRandom);
    coupleRoot = root;
    devices[alice]!.cipher = cipherWithKey(root, world.coupleId, 'intimacy');

    const deviceKeyId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select id from public.device_keys where profile_id = $1',
        [bob],
      );
      return rows[0].id as string;
    });

    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.couple_key_wraps (couple_id, device_key_id, epoch, wrapped_key, wrapped_by)
         values ($1, $2, 0, $3, $4)`,
        [
          world.coupleId,
          deviceKeyId,
          wrapCoupleKey({
            root,
            mySecret: devices[alice]!.keypair.secretKey,
            myPublic: devices[alice]!.keypair.publicKey,
            theirPublic: devices[bob]!.keypair.publicKey,
            coupleId: world.coupleId,
            epoch: 0,
            random: testRandom,
          }),
          alice,
        ],
      ),
    );

    // Bob's device opens it with its own secret and nothing else.
    const wrapped = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select wrapped_key from public.couple_key_wraps');
      return rows[0].wrapped_key as string;
    });

    const opened: CoupleRootKey = unwrapCoupleKey({
      wrapped,
      mySecret: devices[bob]!.keypair.secretKey,
      myPublic: devices[bob]!.keypair.publicKey,
      theirPublic: devices[alice]!.keypair.publicKey,
      coupleId: world.coupleId,
      epoch: 0,
    });

    expect(Array.from(opened)).toEqual(Array.from(root));
    devices[bob]!.cipher = cipherWithKey(opened, world.coupleId, 'intimacy');
  });

  it('will not open for a device the wrap was not addressed to', async () => {
    const carolDevice = generateDeviceKeypair(testRandom);
    const wrapped = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select wrapped_key from public.couple_key_wraps');
      return rows[0].wrapped_key as string;
    });

    expect(() =>
      unwrapCoupleKey({
        wrapped,
        mySecret: carolDevice.secretKey,
        myPublic: carolDevice.publicKey,
        theirPublic: devices[alice]!.keypair.publicKey,
        coupleId: world.coupleId,
        epoch: 0,
      }),
    ).toThrow();
  });

  /**
   * The second app on the same phone, against the real policies.
   *
   * SecureStore is scoped per app bundle, so installing Two22 next to Us gives
   * a signed-in, paired, keyless device belonging to *you*. CLAUDE.md says
   * "installing the second app finds the couple already connected"; if only a
   * partner could approve a device, that sentence stopped being true the moment
   * encryption shipped. What makes it work is that `couple_key_wraps` asks for
   * membership and `wrapped_by = auth.uid()`, and says nothing about whose
   * device the wrap is for.
   */
  it('lets a partner approve their own second install', async () => {
    const secondApp = generateDeviceKeypair(testRandom);

    const deviceKeyId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'insert into public.device_keys (profile_id, public_key) values ($1, $2) returning id',
        [alice, toBase64(secondApp.publicKey)],
      );
      return rows[0].id as string;
    });

    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.couple_key_wraps (couple_id, device_key_id, epoch, wrapped_key, wrapped_by)
         values ($1, $2, 0, $3, $4)`,
        [
          world.coupleId,
          deviceKeyId,
          wrapCoupleKey({
            root: coupleRoot,
            mySecret: devices[alice]!.keypair.secretKey,
            myPublic: devices[alice]!.keypair.publicKey,
            theirPublic: secondApp.publicKey,
            coupleId: world.coupleId,
            epoch: 0,
            random: testRandom,
          }),
          alice,
        ],
      ),
    );

    const wrapped = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select wrapped_key from public.couple_key_wraps where device_key_id = $1',
        [deviceKeyId],
      );
      return rows[0].wrapped_key as string;
    });

    const opened = unwrapCoupleKey({
      wrapped,
      mySecret: secondApp.secretKey,
      myPublic: secondApp.publicKey,
      theirPublic: devices[alice]!.keypair.publicKey,
      coupleId: world.coupleId,
      epoch: 0,
    });

    // Byte-identical, so the second app derives the same content keys — and can
    // therefore read what the first app wrote, which is the whole promise.
    expect(Buffer.from(opened).equals(Buffer.from(coupleRoot))).toBe(true);
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
  it('creates the plan and the proposal', async () => {
    // Mirrors useProposeTime: a `proposed` plan plus a proposal row.
    const start = new Date('2026-09-12T23:00:00.000Z'); // 19:00 in New York
    const end = new Date('2026-09-13T01:00:00.000Z');
    world.startsAt = start.toISOString();
    world.endsAt = end.toISOString();

    const ids = await asUser(pool, alice, async (client) => {
      const planId = cipherOf(alice).newId();
      const { rows: planRows } = await client.query(
        `insert into public.plans
           (id, couple_id, domain, kind, payload, starts_at, ends_at, status, created_by)
         values ($1, $2, 'intimacy', 'intimacy', $3, $4, $5, 'proposed', $6)
         returning id`,
        [
          planId,
          world.coupleId,
          sealPlanFor(alice, planId, { title: null, notes: NOTE, location: null }),
          world.startsAt,
          world.endsAt,
          alice,
        ],
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

  /**
   * The assertion this entire piece of work exists for.
   *
   * `pool` connects as the owning superuser, which is precisely the position
   * whoever runs the database is in: no policy applies, every row is visible.
   * What they get is a base64 blob.
   */
  it('is unreadable to whoever runs the database', async () => {
    const { rows } = await pool.query('select * from public.plans where id = $1', [world.planId]);
    const asText = JSON.stringify(rows[0]);

    expect(asText).not.toContain('dessert');
    expect(asText).not.toContain('ocho');
    expect(asText).not.toContain(NOTE);

    // And the shape is what we think it is — no leftover column to read it from.
    expect(Object.keys(rows[0]!)).not.toContain('notes');
    expect(Object.keys(rows[0]!)).toContain('payload');
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
      const counterPlanId = cipherOf(alice).newId();
      const { rows: planRows } = await client.query(
        `insert into public.plans (id, couple_id, domain, kind, payload, starts_at, ends_at, status, created_by)
         values ($1, $2, 'intimacy', 'intimacy', $3, $4, $5, 'proposed', $6) returning id`,
        [
          counterPlanId,
          world.coupleId,
          sealPlanFor(alice, counterPlanId, { title: null, notes: null, location: null }),
          '2026-10-01T23:00:00.000Z',
          '2026-10-02T01:00:00.000Z',
          alice,
        ],
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
 * The last rung, and the one nothing else in the repo walks end to end.
 *
 * Step 2b covers the ordinary way a device gets the key: a partner wraps it.
 * This covers the case that has no partner in it — both phones gone at once —
 * where the only thing standing between a couple and an empty database is
 * twenty-five characters on a piece of paper. It runs the real scrypt against
 * a real row and reads a real plan back through the real mapper, because the
 * question it answers is whether the key that comes out is the same key, not
 * whether the envelope round-trips in isolation.
 */
describe('8. losing both devices', () => {
  /** The paper. Written down in Settings, on a phone that no longer exists. */
  let code: string;

  it('seals the couple key under a code Alice writes down', async () => {
    code = generateRecoveryCode(testRandom);

    const envelope = await wrapWithRecoveryCode({
      root: coupleRoot,
      code,
      coupleId: world.coupleId,
      epoch: 0,
      random: testRandom,
    });

    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.couple_key_recovery
           (profile_id, couple_id, epoch, kdf, kdf_salt, kdf_params, wrapped_key)
         values ($1, $2, 0, $3, $4, $5::jsonb, $6)`,
        [
          alice,
          world.coupleId,
          envelope.kdf,
          envelope.salt,
          JSON.stringify(envelope.params),
          envelope.wrapped,
        ],
      ),
    );

    // Bob cannot see it, and does not need to: it is Alice's way back into a
    // couple he is also in, not a second copy of the couple key for him.
    const bobSees = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select 1 from public.couple_key_recovery');
      return rows;
    });
    expect(bobSees).toEqual([]);
  });

  /** The row as the replacement phone reads it: `jsonb` back as an object. */
  async function storedEnvelope(): Promise<{
    epoch: number;
    envelope: { kdf: 'scrypt-v1'; salt: string; params: ScryptParams; wrapped: string };
  }> {
    return asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{
        epoch: number;
        kdf: 'scrypt-v1';
        kdf_salt: string;
        kdf_params: ScryptParams;
        wrapped_key: string;
      }>(
        `select epoch, kdf, kdf_salt, kdf_params, wrapped_key
         from public.couple_key_recovery`,
      );
      const row = rows[0]!;
      return {
        epoch: row.epoch,
        envelope: {
          kdf: row.kdf,
          salt: row.kdf_salt,
          params: row.kdf_params,
          wrapped: row.wrapped_key,
        },
      };
    });
  }

  it('opens on a replacement phone and reads what was written before it existed', async () => {
    const stored = await storedEnvelope();

    // Typed off paper: lower case, spaces instead of hyphens. Crockford folds
    // all of it, which is the difference between a recovery code and a puzzle.
    const asTyped = code.toLowerCase().replace(/-/g, ' ');

    const root: CoupleRootKey = await unwrapWithRecoveryCode({
      envelope: stored.envelope,
      code: asTyped,
      coupleId: world.coupleId,
      epoch: stored.epoch,
    });

    expect(Array.from(root)).toEqual(Array.from(coupleRoot));

    // The assertion that matters. A key that merely decrypts *something* is not
    // the claim being made — this is the plan Alice wrote in step 4, on a
    // device that has never met either of the two phones that could read it.
    const plans = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.plans order by created_at');
      return rows.map((row) => toPlan(row, cipherWithKey(root, world.coupleId, 'intimacy')));
    });

    expect(plans[0]!.unreadable).toBe(false);
    expect(plans[0]!.notes).toBe(NOTE);
  });

  it('refuses a code that is nearly right', async () => {
    const stored = await storedEnvelope();

    // One character out of twenty-five. There is no checksum in this format —
    // the Poly1305 tag is the checksum, and it fails closed.
    const wrong = code.slice(0, -1) + (code.endsWith('0') ? '1' : '0');

    await expect(
      unwrapWithRecoveryCode({
        envelope: stored.envelope,
        code: wrong,
        coupleId: world.coupleId,
        epoch: stored.epoch,
      }),
    ).rejects.toThrow();
  });
});

/**
 * The one rule encryption took off the server.
 *
 * `profiles.display_name` used to be a plain column with a 1..80 `CHECK`. What
 * the server holds now is `name_payload`, and `profiles_name_payload_bounded`
 * bounds the *ciphertext* at 64..1000 base64 characters — a ceiling to stop the
 * column becoming blob storage, not a measurement of the name inside it.
 *
 * Those two limits were written at different times and never checked against
 * each other. A name at the client-side maximum has to clear the server-side
 * one after JSON framing, 64-byte padding and base64, and a one-character name
 * has to reach the floor. Neither is obvious by inspection, and getting it
 * wrong means a constraint violation on a name somebody actually typed.
 */
describe('9. putting a name to it', () => {
  function sealName(name: string, profileId: string): string {
    return cipherWithKey(coupleRoot, world.coupleId, 'shared').seal(
      { displayName: name },
      { table: 'profiles', coupleId: world.coupleId, profileId },
    );
  }

  it('accepts a name at the client-side maximum, in its longest possible form', async () => {
    // 80 code points of four UTF-8 bytes each — the worst case the rule admits,
    // and 320 bytes rather than the 80 an ASCII reading would assume.
    const longest = '😀'.repeat(DISPLAY_NAME_MAX);
    expect(displayNameLength(longest)).toBe(DISPLAY_NAME_MAX);

    const payload = sealName(longest, alice);
    expect(payload.length).toBeGreaterThanOrEqual(64);
    expect(payload.length).toBeLessThanOrEqual(1000);

    await asUser(pool, alice, (client) =>
      client.query('update public.profiles set name_payload = $1 where id = $2', [payload, alice]),
    );
  });

  it('reaches the floor with a one-character name', async () => {
    // The other end: 64 is a *minimum*, and a short name padded to one bucket
    // has to clear it. It does, because the header, nonce and tag alone are 46
    // bytes before any content.
    const payload = sealName('A', bob);
    expect(payload.length).toBeGreaterThanOrEqual(64);

    await asUser(pool, bob, (client) =>
      client.query('update public.profiles set name_payload = $1 where id = $2', [payload, bob]),
    );
  });

  it('shows each partner the other by name, and the server neither', async () => {
    const seen = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select * from public.profiles order by id');
      return rows.map((row) =>
        toProfile(row, cipherWithKey(coupleRoot, world.coupleId, 'shared'), world.coupleId),
      );
    });

    const names = new Map(seen.map((profile) => [profile.id, profile.displayName]));
    expect(names.get(alice)).toBe('😀'.repeat(DISPLAY_NAME_MAX));
    expect(names.get(bob)).toBe('A');
    expect(seen.every((profile) => !profile.unreadable)).toBe(true);

    // And as owner, which is what an operator is: base64 and nothing else.
    // Checked against Alice's name rather than Bob's — 'A' would turn up in
    // base64 by chance, which would make the assertion a coin toss instead of
    // a statement.
    const { rows } = await pool.query('select * from public.profiles where id = $1', [alice]);
    const asText = JSON.stringify(rows[0]);

    expect(rows[0]!.name_payload).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(asText).not.toContain('😀');
    // No leftover column to read it out of, either.
    expect(Object.keys(rows[0]!)).not.toContain('display_name');
  });
});

/**
 * Where it actually is.
 *
 * The 2-2-2 app is the one that answers "where", and it answers it with no
 * mapping provider configured — which is the state every install is in until
 * someone sets a key, and the state this suite runs in. A place typed by hand
 * has to survive the round trip, reach the label a calendar would show, and
 * stay out of that calendar unless somebody asked for it.
 */
describe('10. a place on a 2-2-2 plan', () => {
  let planId = '';
  let placeId = '';

  /** Accented, em-dashed, and in the partner's own language on purpose. */
  const NAME = 'Café Anglès';
  const ADDRESS = 'Carrer dels Almogàvers 1, Barcelona';

  it('books a 2-2-2 date night and attaches a place typed by hand', async () => {
    const startsAt = new Date(Date.now() + 5 * 86_400_000).toISOString();

    const newPlanId = cipherOf(alice).newId();
    const newPlaceId = cipherOf(alice).newId();
    const twoTwoTwo = cipherWithKey(coupleRoot, world.coupleId, 'two_two_two');

    [planId, placeId] = await asUser(pool, alice, async (client) => {
      const { rows: planRows } = await client.query<{ id: string }>(
        `insert into public.plans (id, couple_id, domain, kind, payload, starts_at, status, created_by)
         values ($1, $2, 'two_two_two', 'date_night', $3, $4, 'scheduled', $5)
         returning id`,
        [
          newPlanId,
          world.coupleId,
          // The plan's own cipher is the 2-2-2 one — the domain subkey the
          // other app cannot derive a payload from.
          twoTwoTwo.seal(
            { title: 'dinner', notes: null, location: `${NAME} — ${ADDRESS}` },
            { table: 'plans', coupleId: world.coupleId, id: newPlanId },
          ),
          startsAt,
          alice,
        ],
      );
      const { rows: placeRows } = await client.query<{ id: string }>(
        `insert into public.plan_places
           (id, couple_id, domain, plan_id, payload, provider, attached_by)
         values ($1, $2, 'two_two_two', $3, $4, 'manual', $5)
         returning id`,
        [
          newPlaceId,
          world.coupleId,
          planRows[0]!.id,
          twoTwoTwo.seal(
            {
              name: NAME,
              address: ADDRESS,
              providerPlaceId: null,
              latitude: null,
              longitude: null,
              locale: 'es',
            },
            { table: 'plan_places', coupleId: world.coupleId, id: newPlaceId },
          ),
          alice,
        ],
      );
      return [planRows[0]!.id, placeRows[0]!.id];
    });

    expect(planId).toBeTruthy();
    expect(placeId).toBeTruthy();
  });

  it('shows Bob the place verbatim, accents and all', async () => {
    const row = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select * from public.plan_places where id = $1', [
        placeId,
      ]);
      return rows[0];
    });

    // Bob's device derives the same 2-2-2 content key from the couple key his
    // own device unwrapped in step 2b, and opens what Alice's device sealed.
    const place = toPlanPlace(row, cipherWithKey(coupleRoot, world.coupleId, 'two_two_two'));

    // Authored text. Byte-identical, never machine-translated — the same
    // property this suite already pins for a proposal's note.
    expect(place.unreadable).toBe(false);
    expect(place.name).toBe(NAME);
    expect(place.address).toBe(ADDRESS);
    // Labelled with the language it was written in, so Bob is told rather than
    // shown a translation.
    expect(place.locale).toBe('es');
    // Nothing was searched, so there is nothing a provider gave us.
    expect(place.provider).toBe('manual');
    expect(place.coordinates).toBeNull();
    expect(place.providerPlaceId).toBeNull();

    // And to whoever runs the database, the row says only that this couple has
    // a manually-entered place on a 2-2-2 plan.
    const { rows } = await pool.query('select * from public.plan_places where id = $1', [placeId]);
    const asText = JSON.stringify(rows[0]);
    expect(asText).not.toContain(NAME);
    expect(asText).not.toContain(ADDRESS);
    expect(Object.keys(rows[0]!)).not.toContain('address');
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
    const plan = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.plans where id = $1', [planId]);
      return toPlan(rows[0], cipherWithKey(coupleRoot, world.coupleId, 'two_two_two'));
    });
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

    const twoTwoTwo = cipherWithKey(coupleRoot, world.coupleId, 'two_two_two');
    const [place, plan] = await Promise.all([
      asUser(pool, bob, async (client) => {
        const { rows } = await client.query('select * from public.plan_places where id = $1', [
          placeId,
        ]);
        return rows[0];
      }),
      asUser(pool, bob, async (client) => {
        const { rows } = await client.query('select * from public.plans where id = $1', [planId]);
        // The 2-2-2 cipher, deliberately: this is a 2-2-2 plan, and the
        // intimacy cipher the rest of this file uses cannot open it. That is
        // invariant 2 as arithmetic rather than convention.
        return toPlan(rows[0], twoTwoTwo);
      }),
    ]);

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
