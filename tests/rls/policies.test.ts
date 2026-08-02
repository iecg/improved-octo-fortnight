/**
 * The security-critical suite.
 *
 * Two couples exist throughout: Alice + Bob, and Carol + Dave. Almost every
 * test is a variation on one question — can someone in couple B touch couple
 * A's data — plus the authorship rules that stop one partner from acting as
 * the other.
 */
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cipherFor, newId, sealCheckin, sealIdea, sealPlan } from '../support/crypto';
import { asAnon, asUser, createTestDatabase, createUser, expectRejected } from './harness';

let pool: Pool;
let alice: string;
let bob: string;
let carol: string;
let dave: string;
let eve: string;
let coupleA: string;
let coupleB: string;

async function createCouple(userId: string): Promise<{ id: string; inviteCode: string }> {
  return asUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ id: string; invite_code: string }>(
      'select * from public.create_couple($1)',
      ['America/New_York'],
    );
    return { id: rows[0]!.id, inviteCode: rows[0]!.invite_code };
  });
}

async function currentInviteCode(userId: string, coupleId: string): Promise<string> {
  return asUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ invite_code: string }>(
      'select invite_code from public.couples where id = $1',
      [coupleId],
    );
    return rows[0]!.invite_code;
  });
}

interface JoinResult {
  ok: boolean;
  reason?: string;
  couple_id?: string;
}

/** join_couple returns a result rather than raising, so a failed attempt can be counted. */
async function joinCouple(userId: string, code: string): Promise<JoinResult> {
  return asUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ join_couple: JoinResult }>(
      'select public.join_couple($1) as join_couple',
      [code],
    );
    return rows[0]!.join_couple;
  });
}

/** The id is minted here because the payload's AAD binds to it. */
async function seedPlan(userId: string, coupleId: string, domain: string): Promise<string> {
  const id = newId();
  return asUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
       values ($1, $2, $3, 'intimacy', $4, 'idea', $5) returning id`,
      [id, coupleId, domain, sealPlan(coupleId, id, { title: 'seed' }), userId],
    );
    return rows[0]!.id;
  });
}

/**
 * A payload for a row the statement is expected never to create. RLS refuses it
 * before the bytes matter, but the column is `not null`, so something has to be
 * there or the test would pass on a constraint violation instead of a policy.
 */
const sealPlaceholder = sealPlan(
  '00000000-0000-4000-8000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  { title: 'never written' },
);

const sealPlaceholderIdea = sealIdea(
  '00000000-0000-4000-8000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  { title: 'never written' },
);

/** `current_date` as the database will store it, so an AAD matches. */
function todayIso(): string {
  return dateIso(0);
}

function dateIso(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);
}

/** What a plan actually says, read back the way the app would. */
function planTitle(coupleId: string, id: string, payload: string): string | null {
  const fields = cipherFor(coupleId).open(payload, { table: 'plans', coupleId, id });
  return (fields.title as string | null) ?? null;
}

beforeAll(async () => {
  pool = await createTestDatabase();
  [alice, bob, carol, dave, eve] = (await Promise.all([
    createUser(pool, 'alice@example.test'),
    createUser(pool, 'bob@example.test'),
    createUser(pool, 'carol@example.test'),
    createUser(pool, 'dave@example.test'),
    createUser(pool, 'eve@example.test'),
  ])) as [string, string, string, string, string];

  const a = await createCouple(alice);
  coupleA = a.id;
  expect((await joinCouple(bob, a.inviteCode)).ok).toBe(true);

  const b = await createCouple(carol);
  coupleB = b.id;
  expect((await joinCouple(dave, b.inviteCode)).ok).toBe(true);
}, 60_000);

afterAll(async () => {
  await pool?.end();
});

describe('pairing', () => {
  it('puts both partners in the same couple', async () => {
    const members = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select profile_id from public.couple_members');
      return rows.map((row) => row.profile_id as string).sort();
    });

    expect(members.sort()).toEqual([alice, bob].sort());
  });

  it('rotates the invite code once it has been used', async () => {
    const fresh = await createUser(pool, `rotate-${Date.now()}@example.test`);
    const couple = await createCouple(fresh);
    const partner = await createUser(pool, `rotate-partner-${Date.now()}@example.test`);

    expect((await joinCouple(partner, couple.inviteCode)).ok).toBe(true);
    const after = await currentInviteCode(fresh, couple.id);

    // A forwarded link or a screenshot in a camera roll must not be replayable.
    expect(after).not.toBe(couple.inviteCode);
  });

  it('refuses a third person', async () => {
    const code = await currentInviteCode(alice, coupleA);
    expect(await joinCouple(eve, code)).toMatchObject({ ok: false, reason: 'couple_full' });
  });

  it('refuses an invalid code', async () => {
    expect(await joinCouple(eve, 'ZZZZZZZZ')).toMatchObject({
      ok: false,
      reason: 'invalid_code',
    });
  });

  it('refuses someone who is already paired', async () => {
    const error = await expectRejected(
      asUser(pool, bob, (c) => c.query('select * from public.create_couple($1)', ['UTC'])),
    );

    expect(error.message).toMatch(/already paired/i);
  });

  it('never lets a couple grow past two, even by direct insert', async () => {
    const error = await expectRejected(
      asUser(pool, eve, (c) =>
        c.query('insert into public.couple_members (couple_id, profile_id) values ($1, $2)', [
          coupleA,
          eve,
        ]),
      ),
    );

    // Three defences stand behind this, and which one answers depends on how
    // far the statement gets. There is no insert privilege on the table at all
    // (membership is only ever written inside create_couple/join_couple), so
    // in practice it stops there — before RLS, and long before the size
    // trigger. Any of the three is a pass; silence is not.
    expect(error.message).toMatch(/permission denied|row-level security|at most two members/i);
  });
});

describe('cross-couple isolation', () => {
  it('hides the other couple entirely', async () => {
    const visible = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select id from public.couples');
      return rows.map((row) => row.id as string);
    });

    expect(visible).toEqual([coupleB]);
  });

  it.each([
    [
      'plans',
      `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
       values (gen_random_uuid(), $1, 'intimacy', 'intimacy', '${sealPlaceholder}', 'idea', $2)`,
    ],
    [
      'cadences',
      "insert into public.cadences (couple_id, domain, kind, interval_value, interval_unit) values ($1, 'intimacy', 'intimacy', 1, 'week')",
    ],
    [
      'checkins',
      `insert into public.checkins (couple_id, profile_id, on_date, payload)
       values ($1, $2, current_date, '${sealCheckin('placeholder', 'placeholder', 'placeholder', { interest: 'yes' })}')`,
    ],
  ])("refuses writes to the other couple's %s", async (_table, sql) => {
    const error = await expectRejected(
      asUser(pool, carol, (client) =>
        sql.includes('$2') ? client.query(sql, [coupleA, carol]) : client.query(sql, [coupleA]),
      ),
    );

    expect(error.message).toMatch(/row-level security/i);
  });

  it("returns nothing when reading the other couple's plans", async () => {
    await seedPlan(alice, coupleA, 'intimacy');

    const rows = await asUser(pool, carol, async (client) => {
      const result = await client.query('select id from public.plans where couple_id = $1', [
        coupleA,
      ]);
      return result.rows;
    });

    expect(rows).toEqual([]);
  });

  it("cannot update or delete the other couple's plan", async () => {
    const planId = await seedPlan(alice, coupleA, 'intimacy');

    const updated = await asUser(pool, carol, async (client) => {
      const result = await client.query('update public.plans set payload = $2 where id = $1', [
        planId,
        sealPlan(coupleB, planId, { title: 'hijacked' }),
      ]);
      return result.rowCount;
    });
    const deleted = await asUser(pool, carol, async (client) => {
      const result = await client.query('delete from public.plans where id = $1', [planId]);
      return result.rowCount;
    });

    // RLS filters the rows out before the write applies, so these are silent
    // no-ops rather than errors. Asserting on the count is what catches a
    // policy that accidentally allowed the row through.
    expect(updated).toBe(0);
    expect(deleted).toBe(0);

    const stillThere = await asUser(pool, alice, async (client) => {
      const result = await client.query('select payload from public.plans where id = $1', [planId]);
      return planTitle(coupleA, planId, result.rows[0]?.payload as string);
    });
    expect(stillThere).toBe('seed');
  });

  it("hides the other couple's profiles", async () => {
    const visible = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select id from public.profiles');
      return rows.map((row) => row.id as string).sort();
    });

    expect(visible).toEqual([alice, bob].sort());
  });
});

describe('authorship', () => {
  it('will not let one partner check in for the other', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.checkins (couple_id, profile_id, on_date, payload)
           values ($1, $2, current_date, $3)`,
          [coupleA, bob, sealCheckin(coupleA, bob, todayIso(), { interest: 'yes' })],
        ),
      ),
    );

    expect(error.message).toMatch(/row-level security/i);
  });

  it('lets each partner record their own check-in', async () => {
    const inserted = await asUser(pool, alice, async (client) => {
      const result = await client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, payload)
         values ($1, $2, date '2026-05-01', $3) returning id`,
        [
          coupleA,
          alice,
          sealCheckin(coupleA, alice, '2026-05-01', {
            interest: 'maybe',
            note: 'escribí esto en español',
          }),
        ],
      );
      return result.rowCount;
    });

    expect(inserted).toBe(1);
  });

  it('shows a check-in to the partner verbatim', async () => {
    await asUser(pool, bob, (client) =>
      client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, payload)
         values ($1, $2, date '2026-05-02', $3)`,
        [
          coupleA,
          bob,
          sealCheckin(coupleA, bob, '2026-05-02', { interest: 'yes', note: 'written in English' }),
        ],
      ),
    );

    // Alice reads what Bob wrote, through Bob's own row, with the couple key
    // they share. Verbatim still means verbatim; it is simply sealed on the way.
    const note = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        "select payload from public.checkins where profile_id = $1 and on_date = date '2026-05-02'",
        [bob],
      );
      const fields = cipherFor(coupleA).open(rows[0]?.payload as string, {
        table: 'checkins',
        coupleId: coupleA,
        profileId: bob,
        onDate: '2026-05-02',
      });
      return fields.note as string;
    });

    expect(note).toBe('written in English');
  });

  it('will not let a plan be attributed to the other partner', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
           values (gen_random_uuid(), $1, 'intimacy', 'intimacy', $3, 'idea', $2)`,
          [coupleA, bob, sealPlaceholder],
        ),
      ),
    );

    expect(error.message).toMatch(/row-level security/i);
  });

  it('will not let someone answer their own proposal', async () => {
    const planId = await seedPlan(alice, coupleA, 'intimacy');
    const proposalId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plan_proposals (plan_id, couple_id, proposed_by, starts_at, ends_at)
         values ($1, $2, $3, now() + interval '1 day', now() + interval '1 day 2 hours')
         returning id`,
        [planId, coupleA, alice],
      );
      return rows[0]!.id;
    });

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query("update public.plan_proposals set response = 'accepted' where id = $1", [
          proposalId,
        ]),
      ),
    );
    expect(error.message).toMatch(/answered by the other partner/i);

    // The partner can.
    const accepted = await asUser(pool, bob, async (client) => {
      const result = await client.query(
        "update public.plan_proposals set response = 'accepted' where id = $1",
        [proposalId],
      );
      return result.rowCount;
    });
    expect(accepted).toBe(1);
  });

  it('stamps the responder and the time automatically', async () => {
    const planId = await seedPlan(alice, coupleA, 'intimacy');
    const proposalId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plan_proposals (plan_id, couple_id, proposed_by, starts_at, ends_at)
         values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour')
         returning id`,
        [planId, coupleA, alice],
      );
      return rows[0]!.id;
    });

    await asUser(pool, bob, (client) =>
      client.query("update public.plan_proposals set response = 'declined' where id = $1", [
        proposalId,
      ]),
    );

    const row = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select responded_by, responded_at from public.plan_proposals where id = $1',
        [proposalId],
      );
      return rows[0]!;
    });

    expect(row.responded_by).toBe(bob);
    expect(row.responded_at).not.toBeNull();
  });

  /**
   * The two ways the responder check used to be forgeable. It compared
   * `new.responded_by` against `new.proposed_by`, and the caller supplied both
   * in the same statement, so naming the partner on either side of that
   * comparison let a proposer accept their own proposal — leaving a row saying
   * the partner had agreed to a time they had never been shown.
   */
  async function seedProposal(offsetDays: number): Promise<string> {
    const planId = await seedPlan(alice, coupleA, 'intimacy');
    return asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plan_proposals (plan_id, couple_id, proposed_by, starts_at, ends_at)
         values ($1, $2, $3,
                 now() + ($4 || ' days')::interval,
                 now() + ($4 || ' days')::interval + interval '2 hours')
         returning id`,
        [planId, coupleA, alice, String(offsetDays)],
      );
      return rows[0]!.id;
    });
  }

  it('will not let anyone rewrite who proposed', async () => {
    const proposalId = await seedProposal(5);

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query('update public.plan_proposals set proposed_by = $2 where id = $1', [
          proposalId,
          bob,
        ]),
      ),
    );
    expect(error.message).toMatch(/proposed_by cannot be changed/i);
  });

  /**
   * Both guards cover this one. The responder check gets there first — it
   * compares against `old.proposed_by`, so it holds whether or not the
   * immutability trigger runs before it — and the immutability trigger would
   * refuse the same statement on its own. Asserted on the outcome rather than
   * the message, since which one speaks is down to trigger name ordering.
   */
  it('will not let a proposer accept by renaming the proposer', async () => {
    const proposalId = await seedProposal(8);

    await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `update public.plan_proposals
           set proposed_by = $2, response = 'accepted'
           where id = $1`,
          [proposalId, bob],
        ),
      ),
    );

    const row = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select proposed_by, response from public.plan_proposals where id = $1',
        [proposalId],
      );
      return rows[0]!;
    });
    expect(row.proposed_by).toBe(alice);
    expect(row.response).toBe('pending');
  });

  it('will not let a proposer accept by naming the partner as responder', async () => {
    const proposalId = await seedProposal(6);

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `update public.plan_proposals
           set responded_by = $2, response = 'accepted'
           where id = $1`,
          [proposalId, bob],
        ),
      ),
    );
    expect(error.message).toMatch(/answered by the other partner/i);
  });

  it('records the partner as responder even when the client claims otherwise', async () => {
    const proposalId = await seedProposal(7);

    // Bob may answer, but the stamp comes from auth.uid(), not from the write.
    await asUser(pool, bob, (client) =>
      client.query(
        `update public.plan_proposals
         set responded_by = $2, response = 'accepted'
         where id = $1`,
        [proposalId, alice],
      ),
    );

    const row = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        'select responded_by from public.plan_proposals where id = $1',
        [proposalId],
      );
      return rows[0]!;
    });
    expect(row.responded_by).toBe(bob);
  });

  /**
   * Every authorship rule in the RLS migration is an insert-time `with check`.
   * The update policies check only membership, so without these the pins were
   * one UPDATE away from meaningless.
   */
  it('will not let a partner reattribute a plan', async () => {
    const planId = await seedPlan(alice, coupleA, 'intimacy');

    const error = await expectRejected(
      asUser(pool, bob, (client) =>
        client.query('update public.plans set created_by = $2 where id = $1', [planId, bob]),
      ),
    );
    expect(error.message).toMatch(/created_by cannot be changed/i);
  });

  it('will not let a partner reattribute a check-in', async () => {
    const checkinId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.checkins (couple_id, profile_id, on_date, payload)
         values ($1, $2, current_date + 40, $3) returning id`,
        [coupleA, alice, sealCheckin(coupleA, alice, dateIso(40), { interest: 'maybe' })],
      );
      return rows[0]!.id;
    });

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query('update public.checkins set profile_id = $2 where id = $1', [checkinId, bob]),
      ),
    );
    expect(error.message).toMatch(/profile_id cannot be changed/i);
  });

  it('will not let a partner reattribute a saved idea', async () => {
    const ideaId = newId();
    await asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plan_ideas (id, couple_id, domain, kind, payload, source, saved_by)
         values ($1, $2, 'two_two_two', 'date_night', $3, 'manual', $4) returning id`,
        [ideaId, coupleA, sealIdea(coupleA, ideaId, { title: 'a picnic' }), alice],
      );
      return rows[0]!.id;
    });

    const error = await expectRejected(
      asUser(pool, bob, (client) =>
        client.query('update public.plan_ideas set saved_by = $2 where id = $1', [ideaId, bob]),
      ),
    );
    expect(error.message).toMatch(/saved_by cannot be changed/i);

    // Editing the idea itself is still fine — only the attribution is pinned.
    const edited = await asUser(pool, bob, async (client) => {
      const result = await client.query('update public.plan_ideas set payload = $2 where id = $1', [
        ideaId,
        sealIdea(coupleA, ideaId, { title: 'a picnic, but earlier' }),
      ]);
      return result.rowCount;
    });
    expect(edited).toBe(1);
  });
});

/**
 * What happens to a couple's data when a member leaves.
 *
 * Leaving is a plain delete from `couple_members` and nothing followed it, so
 * two things were left open: the invite code that circulated while the couple
 * was full went live again the moment a slot reopened, and a couple whose last
 * member left kept every row it had — reachable by anyone who redeemed that
 * still-valid code.
 *
 * These use their own users throughout; the shared couples have to survive the
 * file.
 */
describe('leaving a couple', () => {
  async function freshPair(tag: string): Promise<{ couple: string; a: string; b: string }> {
    const a = await createUser(pool, `${tag}-a-${Date.now()}@example.test`);
    const b = await createUser(pool, `${tag}-b-${Date.now()}@example.test`);
    const couple = await createCouple(a);
    expect((await joinCouple(b, couple.inviteCode)).ok).toBe(true);
    return { couple: couple.id, a, b };
  }

  it('rotates the invite code when a partner leaves', async () => {
    const { couple, a, b } = await freshPair('rotate-on-leave');
    const circulated = await currentInviteCode(a, couple);

    await asUser(pool, b, (client) =>
      client.query('delete from public.couple_members where profile_id = $1', [b]),
    );

    expect(await currentInviteCode(a, couple)).not.toBe(circulated);

    // The code from the screenshot no longer opens the seat it reopened.
    const stranger = await createUser(pool, `rotate-stranger-${Date.now()}@example.test`);
    expect(await joinCouple(stranger, circulated)).toMatchObject({
      ok: false,
      reason: 'invalid_code',
    });
  });

  it('deletes a couple once its last member is gone', async () => {
    const { couple, a, b } = await freshPair('last-member');
    await asUser(pool, a, (client) =>
      client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, payload)
         values ($1, $2, current_date, $3)`,
        [
          couple,
          a,
          sealCheckin(couple, a, todayIso(), { interest: 'yes', note: 'a private note' }),
        ],
      ),
    );

    for (const member of [a, b]) {
      await asUser(pool, member, (client) =>
        client.query('delete from public.couple_members where profile_id = $1', [member]),
      );
    }

    // Checked as owner: no policy could see these rows either way, and the
    // point is that they are gone rather than merely hidden.
    const couples = await pool.query('select 1 from public.couples where id = $1', [couple]);
    const checkins = await pool.query('select 1 from public.checkins where couple_id = $1', [
      couple,
    ]);
    expect(couples.rowCount).toBe(0);
    expect(checkins.rowCount).toBe(0);
  });

  it('leaves no abandoned couple for a stranger to join', async () => {
    const { couple, a, b } = await freshPair('abandoned');
    const circulated = await currentInviteCode(a, couple);

    for (const member of [a, b]) {
      await asUser(pool, member, (client) =>
        client.query('delete from public.couple_members where profile_id = $1', [member]),
      );
    }

    const stranger = await createUser(pool, `abandoned-stranger-${Date.now()}@example.test`);
    expect(await joinCouple(stranger, circulated)).toMatchObject({
      ok: false,
      reason: 'invalid_code',
    });
  });

  it('cleans up after the last member deletes their account', async () => {
    const { couple, a, b } = await freshPair('last-account');

    await pool.query('delete from auth.users where id = any($1)', [[a, b]]);

    const couples = await pool.query('select 1 from public.couples where id = $1', [couple]);
    expect(couples.rowCount).toBe(0);
  });
});

describe('the push token', () => {
  /**
   * `profiles.expo_push_token` was never written — reminders are local — and a
   * partner can read the whole profile row. An Expo token is a bearer
   * credential for posting arbitrary text to that device's lock screen, which
   * is the one thing this product must not do, so the column is gone rather
   * than merely unused.
   */
  it('is not a column anyone can store a credential in', async () => {
    const { rows } = await pool.query(
      `select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'profiles'
         and column_name = 'expo_push_token'`,
    );
    expect(rows).toHaveLength(0);
  });

  it('leaves the client able to write only the three fields it owns', async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.column_privileges
       where grantee = 'authenticated' and table_schema = 'public'
         and table_name = 'profiles' and privilege_type = 'UPDATE'
       order by column_name`,
    );

    expect(rows.map((row) => row.column_name)).toEqual(['locale', 'name_payload', 'timezone']);
  });
});

describe('pairing hardening', () => {
  it('issues eight-character codes from the unambiguous alphabet', async () => {
    const fresh = await createUser(pool, `code-shape-${Date.now()}@example.test`);
    const couple = await createCouple(fresh);

    expect(couple.inviteCode).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
  });

  it('never lets two people redeem the same code at once', async () => {
    // The size trigger alone cannot prevent this: under READ COMMITTED neither
    // transaction sees the other's uncommitted insert, so both pass the count
    // check. Reproduced exactly this way against a schema without the row lock,
    // which produced a three-member couple.
    const founder = await createUser(pool, `race-founder-${Date.now()}@example.test`);
    const couple = await createCouple(founder);
    const first = await createUser(pool, `race-a-${Date.now()}@example.test`);
    const second = await createUser(pool, `race-b-${Date.now()}@example.test`);

    const results = await Promise.all([
      joinCouple(first, couple.inviteCode),
      joinCouple(second, couple.inviteCode),
    ]);

    // Exactly one wins. The loser is told the couple is full, or that the code
    // is invalid because the winner already rotated it — either way, not in.
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const members = await asUser(pool, founder, async (client) => {
      const { rows } = await client.query('select count(*)::int as n from public.couple_members');
      return rows[0]!.n as number;
    });
    expect(members).toBe(2);
  });

  it('rate limits repeated wrong guesses', async () => {
    const guesser = await createUser(pool, `guesser-${Date.now()}@example.test`);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(await joinCouple(guesser, 'ZZZZZZZZ')).toMatchObject({ reason: 'invalid_code' });
    }

    expect(await joinCouple(guesser, 'ZZZZZZZZ')).toMatchObject({ reason: 'rate_limited' });
  });

  it('does not count a correct code against a full couple as a guess', async () => {
    // The code was right, so refusing it leaks nothing — and counting it would
    // let a full couple's circulating code lock a legitimate user out.
    const code = await currentInviteCode(alice, coupleA);
    const bystander = await createUser(pool, `bystander-${Date.now()}@example.test`);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await joinCouple(bystander, code)).toMatchObject({ reason: 'couple_full' });
    }

    const attempts = await pool.query<{ attempts: number }>(
      'select attempts from public.join_attempts where profile_id = $1',
      [bystander],
    );
    expect(attempts.rows[0]?.attempts ?? 0).toBe(0);
  });

  it('keeps the rate-limit table out of client reach', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (c) => c.query('select * from public.join_attempts')),
    );

    expect(error.message).toMatch(/permission denied/i);
  });
});

describe('plan integrity', () => {
  it('refuses a completed plan with no completion time', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by, starts_at)
           values (gen_random_uuid(), $1, 'intimacy', 'intimacy', $3, 'completed', $2, now())`,
          [coupleA, alice, sealPlaceholder],
        ),
      ),
    );

    expect(error.message).toMatch(/plans_completed_has_timestamp/i);
  });

  it('clears the completion time when a plan stops being complete', async () => {
    const planId = await seedPlan(alice, coupleA, 'intimacy');
    await asUser(pool, alice, (c) =>
      c.query("update public.plans set status = 'completed', completed_at = now() where id = $1", [
        planId,
      ]),
    );

    const error = await expectRejected(
      asUser(pool, alice, (c) =>
        c.query("update public.plans set status = 'skipped' where id = $1", [planId]),
      ),
    );

    // A stale completed_at would silently re-anchor the cadence to something
    // that never happened, so the database refuses the half-update.
    expect(error.message).toMatch(/plans_completed_has_timestamp/i);
  });

  /**
   * The couple is two people on purpose: the plan has to survive *for the
   * partner still using it*, which is the whole reason `created_by` is
   * `on delete set null` rather than `on delete cascade`. A one-member couple
   * would leave nobody to keep the history for, and is now cleaned up instead
   * — see 'deletes a couple once its last member is gone'.
   */
  it('keeps shared history when a partner deletes their account', async () => {
    const leaver = await createUser(pool, `history-leaver-${Date.now()}@example.test`);
    const stayer = await createUser(pool, `history-stayer-${Date.now()}@example.test`);
    const couple = await createCouple(leaver);
    expect((await joinCouple(stayer, couple.inviteCode)).ok).toBe(true);

    const planId = newId();
    await asUser(pool, leaver, (client) =>
      client.query(
        `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
         values ($1, $2, 'intimacy', 'intimacy', $3, 'idea', $4)`,
        [planId, couple.id, sealPlan(couple.id, planId, { title: 'a shared evening' }), leaver],
      ),
    );

    await pool.query('delete from auth.users where id = $1', [leaver]);

    // Still there, still readable by the partner, and no longer attributed.
    // Readable in both senses: RLS lets the survivor select it, and the couple
    // key still opens it — leaving the couple would have cleared that, deleting
    // one account does not.
    const survivor = await asUser(pool, stayer, (client) =>
      client.query('select payload, created_by from public.plans where id = $1', [planId]),
    );
    expect(planTitle(couple.id, planId, survivor.rows[0]?.payload as string)).toBe(
      'a shared evening',
    );
    expect(survivor.rows[0]?.created_by).toBeNull();
  });
});

describe('2-2-2 owned tables', () => {
  it("hides one couple's ideas from another", async () => {
    const noodleIdeaId = newId();
    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.plan_ideas (id, couple_id, domain, kind, payload, source, saved_by)
         values ($1, $2, 'two_two_two', 'date_night', $3, 'manual', $4)`,
        [
          noodleIdeaId,
          coupleA,
          sealIdea(coupleA, noodleIdeaId, { title: 'the noodle place' }),
          alice,
        ],
      ),
    );

    const visible = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select id from public.plan_ideas');
      return rows;
    });

    expect(visible).toEqual([]);
  });

  it('will not let one partner save an idea as the other', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plan_ideas (id, couple_id, domain, kind, payload, source, saved_by)
           values (gen_random_uuid(), $1, 'two_two_two', 'getaway', $2, 'manual', $3)`,
          [coupleA, sealPlaceholderIdea, bob],
        ),
      ),
    );

    expect(error.message).toMatch(/row-level security/i);
  });

  it('keeps the AI usage counter readable but not writable', async () => {
    // Only the Edge Function's service role increments it; a client that could
    // write here could reset its own daily cap.
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          'insert into public.ai_usage (couple_id, day, request_count) values ($1, current_date, 0)',
          [coupleA],
        ),
      ),
    );
    expect(error.message).toMatch(/permission denied/i);

    const readable = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query('select * from public.ai_usage');
      return rows;
    });
    expect(readable).toEqual([]);
  });
});

describe('column privileges', () => {
  it('lets a member set the couple timezone', async () => {
    const count = await asUser(pool, alice, async (client) => {
      const result = await client.query(
        "update public.couples set timezone = 'Europe/Madrid' where id = $1",
        [coupleA],
      );
      return result.rowCount;
    });

    expect(count).toBe(1);
  });

  it('will not let a member choose their own invite code', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query("update public.couples set invite_code = 'AAAAAA' where id = $1", [coupleA]),
      ),
    );

    // Postgres names the table rather than the column here. The proof that
    // this is the column grant and not a blanket denial is the timezone test
    // above, which updates the same table and succeeds.
    expect(error.message).toMatch(/permission denied/i);
  });
});

describe('anonymous access', () => {
  it.each([
    'profiles',
    'couples',
    'couple_members',
    'cadences',
    'plans',
    'plan_proposals',
    'checkins',
  ])('refuses a signed-out reader on %s', async (table) => {
    const error = await expectRejected(
      asAnon(pool, (client) => client.query(`select * from public.${table}`)),
    );

    expect(error.message).toMatch(/permission denied/i);
  });
});

describe('the key-exchange tables', () => {
  const aliceKey = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWY=';
  const bobKey = 'MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1BRUlNUVVY=';

  it('lets a partner read the other partner device keys', async () => {
    await asUser(pool, alice, (client) =>
      client.query('insert into public.device_keys (profile_id, public_key) values ($1, $2)', [
        alice,
        aliceKey,
      ]),
    );
    await asUser(pool, bob, (client) =>
      client.query('insert into public.device_keys (profile_id, public_key) values ($1, $2)', [
        bob,
        bobKey,
      ]),
    );

    // The partner's public key is what an approving device needs to compute
    // the verification code the two people read to each other.
    const seen = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query(
        'select profile_id from public.device_keys order by profile_id',
      );
      return rows.map((row) => row.profile_id as string).sort();
    });
    expect(seen).toEqual([alice, bob].sort());
  });

  it('hides them from another couple entirely', async () => {
    const seen = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select profile_id from public.device_keys');
      return rows;
    });
    expect(seen).toEqual([]);
  });

  it('will not let one partner publish a key as the other', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query('insert into public.device_keys (profile_id, public_key) values ($1, $2)', [
          bob,
          aliceKey,
        ]),
      ),
    );
    expect(error.message).toMatch(/row-level security/i);
  });

  it('will not let one partner withdraw the other device', async () => {
    const bobsSecond = `Qm9i${'B'.repeat(40)}=`;
    const id = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into public.device_keys (profile_id, public_key) values ($1, $2) returning id',
        [bob, bobsSecond],
      );
      return rows[0]!.id;
    });

    const removed = await asUser(pool, alice, async (client) => {
      const result = await client.query('delete from public.device_keys where id = $1', [id]);
      return result.rowCount;
    });

    // Not an error: RLS narrows the rows the statement can see, so the delete
    // matches nothing and reports as much.
    expect(removed).toBe(0);
    const { rows } = await pool.query('select 1 from public.device_keys where id = $1', [id]);
    expect(rows).toHaveLength(1);

    // This scoping is why "the codes don't match" does different things on the
    // two sides. The approver can only dismiss — a partner's device row is
    // their claim about their own phone. The remedy is `resetDeviceKey`, on the
    // device that owns the identity and is allowed to withdraw it.
  });

  it('has no update privilege on a key or a wrap: they are replaced, not edited', async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `select distinct table_name from information_schema.table_privileges
       where grantee = 'authenticated' and table_schema = 'public'
         and privilege_type = 'UPDATE'
         and table_name in ('device_keys', 'couple_key_wraps')`,
    );
    expect(rows).toEqual([]);
  });

  it("keeps one couple's recovery envelope from the other couple, and from the partner", async () => {
    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.couple_key_recovery
           (profile_id, couple_id, kdf, kdf_salt, kdf_params, wrapped_key)
         values ($1, $2, 'scrypt-v1', 'c2FsdA==', '{"N":16384}'::jsonb, $3)`,
        [alice, coupleA, aliceKey],
      ),
    );

    // Not the partner's business, and never needed by them: partner re-wrap is
    // a different path that does not touch this row.
    const bobSees = await asUser(pool, bob, async (client) => {
      const { rows } = await client.query('select profile_id from public.couple_key_recovery');
      return rows;
    });
    expect(bobSees).toEqual([]);

    const carolSees = await asUser(pool, carol, async (client) => {
      const { rows } = await client.query('select profile_id from public.couple_key_recovery');
      return rows;
    });
    expect(carolSees).toEqual([]);
  });

  it('takes the wraps with the key when a device is revoked', async () => {
    const owner = await createUser(pool, `revoke-${Date.now()}@example.test`);
    const couple = await createCouple(owner);

    const keyId = await asUser(pool, owner, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        'insert into public.device_keys (profile_id, public_key) values ($1, $2) returning id',
        [owner, aliceKey],
      );
      return rows[0]!.id;
    });
    await asUser(pool, owner, (client) =>
      client.query(
        `insert into public.couple_key_wraps (couple_id, device_key_id, wrapped_key, wrapped_by)
         values ($1, $2, $3, $4)`,
        [couple.id, keyId, aliceKey, owner],
      ),
    );

    await asUser(pool, owner, (client) =>
      client.query('delete from public.device_keys where id = $1', [keyId]),
    );

    const { rows } = await pool.query(
      'select 1 from public.couple_key_wraps where device_key_id = $1',
      [keyId],
    );
    expect(rows).toHaveLength(0);
  });
});

/**
 * The schema itself, asserted against `information_schema` rather than against
 * a regex over the migration text. A grep can be fooled by a clever line; this
 * cannot be fooled at all, because it reads the database that actually got
 * built.
 */
describe('no plaintext content column survives anywhere', () => {
  const EXPECTED: Record<string, string[]> = {
    profiles: ['created_at', 'id', 'locale', 'name_payload', 'timezone', 'updated_at'],
    plans: [
      'calendar_event_ids',
      'completed_at',
      'couple_id',
      'created_at',
      'created_by',
      'domain',
      'ends_at',
      'id',
      'kind',
      'payload',
      'starts_at',
      'status',
      'updated_at',
    ],
    checkins: ['couple_id', 'created_at', 'id', 'on_date', 'payload', 'profile_id', 'updated_at'],
    plan_ideas: [
      'couple_id',
      'created_at',
      'domain',
      'id',
      'kind',
      'payload',
      'saved_by',
      'source',
    ],
  };

  it.each(Object.entries(EXPECTED))('%s holds only what it should', async (table, expected) => {
    const { rows } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1 order by column_name`,
      [table],
    );

    // An allowlist rather than a denylist: this fails for a re-added `notes`
    // and equally for a newly invented `mood_summary`.
    expect(rows.map((row) => row.column_name)).toEqual(expected);
  });

  it('no longer defines the check-in interest as a database enum', async () => {
    const { rows } = await pool.query("select 1 from pg_type where typname = 'checkin_interest'");
    expect(rows).toHaveLength(0);
  });
});

describe('constraints', () => {
  it('rejects a plan window that ends before it starts', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by, starts_at, ends_at)
           values (gen_random_uuid(), $1, 'intimacy', 'intimacy', $3, 'idea', $2, now(), now() - interval '1 hour')`,
          [coupleA, alice, sealPlaceholder],
        ),
      ),
    );

    expect(error.message).toMatch(/plans_window_ordered/i);
  });

  it('rejects a booked plan with no time on it', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
           values (gen_random_uuid(), $1, 'intimacy', 'intimacy', $3, 'scheduled', $2)`,
          [coupleA, alice, sealPlaceholder],
        ),
      ),
    );

    expect(error.message).toMatch(/plans_scheduled_needs_time/i);
  });

  it('rejects a domain that is not a slug', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (id, couple_id, domain, kind, payload, status, created_by)
           values (gen_random_uuid(), $1, 'Not A Slug', 'intimacy', $3, 'idea', $2)`,
          [coupleA, alice, sealPlaceholder],
        ),
      ),
    );

    expect(error.message).toMatch(/slug/i);
  });

  it('allows only one check-in per person per day', async () => {
    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, payload)
         values ($1, $2, date '2026-06-01', $3)`,
        [coupleA, alice, sealCheckin(coupleA, alice, '2026-06-01', { interest: 'yes' })],
      ),
    );

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.checkins (couple_id, profile_id, on_date, payload)
           values ($1, $2, date '2026-06-01', $3)`,
          [coupleA, alice, sealCheckin(coupleA, alice, '2026-06-01', { interest: 'not_tonight' })],
        ),
      ),
    );

    expect(error.message).toMatch(/duplicate key|unique/i);
  });
});
