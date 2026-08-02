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

async function seedPlan(userId: string, coupleId: string, domain: string): Promise<string> {
  return asUser(pool, userId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.plans (couple_id, domain, kind, title, status, created_by)
       values ($1, $2, 'intimacy', 'seed', 'idea', $3) returning id`,
      [coupleId, domain, userId],
    );
    return rows[0]!.id;
  });
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
      "insert into public.plans (couple_id, domain, kind, status, created_by) values ($1, 'intimacy', 'intimacy', 'idea', $2)",
    ],
    [
      'cadences',
      "insert into public.cadences (couple_id, domain, kind, interval_value, interval_unit) values ($1, 'intimacy', 'intimacy', 1, 'week')",
    ],
    [
      'checkins',
      "insert into public.checkins (couple_id, profile_id, on_date, interest) values ($1, $2, current_date, 'yes')",
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
      const result = await client.query(
        "update public.plans set title = 'hijacked' where id = $1",
        [planId],
      );
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
      const result = await client.query('select title from public.plans where id = $1', [planId]);
      return result.rows[0]?.title as string | undefined;
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
          `insert into public.checkins (couple_id, profile_id, on_date, interest)
           values ($1, $2, current_date, 'yes')`,
          [coupleA, bob],
        ),
      ),
    );

    expect(error.message).toMatch(/row-level security/i);
  });

  it('lets each partner record their own check-in', async () => {
    const inserted = await asUser(pool, alice, async (client) => {
      const result = await client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, interest, note)
         values ($1, $2, date '2026-05-01', 'maybe', 'escribí esto en español')
         returning id`,
        [coupleA, alice],
      );
      return result.rowCount;
    });

    expect(inserted).toBe(1);
  });

  it('shows a check-in to the partner verbatim', async () => {
    await asUser(pool, bob, (client) =>
      client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, interest, note)
         values ($1, $2, date '2026-05-02', 'yes', 'written in English')`,
        [coupleA, bob],
      ),
    );

    const note = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query(
        "select note from public.checkins where profile_id = $1 and on_date = date '2026-05-02'",
        [bob],
      );
      return rows[0]?.note as string;
    });

    expect(note).toBe('written in English');
  });

  it('will not let a plan be attributed to the other partner', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (couple_id, domain, kind, status, created_by)
           values ($1, 'intimacy', 'intimacy', 'idea', $2)`,
          [coupleA, bob],
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
        `insert into public.checkins (couple_id, profile_id, on_date, interest)
         values ($1, $2, current_date + 40, 'maybe') returning id`,
        [coupleA, alice],
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
    const ideaId = await asUser(pool, alice, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plan_ideas (couple_id, domain, kind, title, source, locale, saved_by)
         values ($1, 'two_two_two', 'date_night', 'a picnic', 'manual', 'en', $2) returning id`,
        [coupleA, alice],
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
      const result = await client.query('update public.plan_ideas set title = $2 where id = $1', [
        ideaId,
        'a picnic, but earlier',
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
        `insert into public.checkins (couple_id, profile_id, on_date, interest, note)
         values ($1, $2, current_date, 'yes', 'a private note')`,
        [couple, a],
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

    expect(rows.map((row) => row.column_name)).toEqual(['display_name', 'locale', 'timezone']);
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
          `insert into public.plans (couple_id, domain, kind, status, created_by, starts_at)
           values ($1, 'intimacy', 'intimacy', 'completed', $2, now())`,
          [coupleA, alice],
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

    const planId = await asUser(pool, leaver, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into public.plans (couple_id, domain, kind, title, status, created_by)
         values ($1, 'intimacy', 'intimacy', 'a shared evening', 'idea', $2) returning id`,
        [couple.id, leaver],
      );
      return rows[0]!.id;
    });

    await pool.query('delete from auth.users where id = $1', [leaver]);

    // Still there, still readable by the partner, and no longer attributed.
    const survivor = await asUser(pool, stayer, (client) =>
      client.query('select title, created_by from public.plans where id = $1', [planId]),
    );
    expect(survivor.rows[0]?.title).toBe('a shared evening');
    expect(survivor.rows[0]?.created_by).toBeNull();
  });
});

describe('2-2-2 owned tables', () => {
  it("hides one couple's ideas from another", async () => {
    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.plan_ideas
           (couple_id, domain, kind, title, source, locale, saved_by)
         values ($1, 'two_two_two', 'date_night', 'the noodle place', 'manual', 'en', $2)`,
        [coupleA, alice],
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
          `insert into public.plan_ideas
             (couple_id, domain, kind, title, source, locale, saved_by)
           values ($1, 'two_two_two', 'getaway', 'not mine', 'manual', 'en', $2)`,
          [coupleA, bob],
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

  /**
   * `tests/guards/realtime-subscriptions.test.ts` checks that a migration says
   * this; this checks that the database agrees. The two catch different
   * mistakes — a statement that is present but misspelled, or in a migration
   * that never applied, reads fine to a grep and still leaves the shortlist
   * frozen on the partner's phone.
   */
  it('streams the shortlist to both devices', async () => {
    const { rows } = await pool.query(
      `select tablename from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public'`,
    );
    const published = rows.map((row) => row.tablename as string);

    expect(published).toContain('plan_ideas');
    // A counter that streamed live is a scoreboard waiting to happen.
    expect(published).not.toContain('ai_usage');
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

describe('constraints', () => {
  it('rejects a plan window that ends before it starts', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (couple_id, domain, kind, status, created_by, starts_at, ends_at)
           values ($1, 'intimacy', 'intimacy', 'idea', $2, now(), now() - interval '1 hour')`,
          [coupleA, alice],
        ),
      ),
    );

    expect(error.message).toMatch(/plans_window_ordered/i);
  });

  it('rejects a booked plan with no time on it', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (couple_id, domain, kind, status, created_by)
           values ($1, 'intimacy', 'intimacy', 'scheduled', $2)`,
          [coupleA, alice],
        ),
      ),
    );

    expect(error.message).toMatch(/plans_scheduled_needs_time/i);
  });

  it('rejects a domain that is not a slug', async () => {
    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.plans (couple_id, domain, kind, status, created_by)
           values ($1, 'Not A Slug', 'intimacy', 'idea', $2)`,
          [coupleA, alice],
        ),
      ),
    );

    expect(error.message).toMatch(/slug/i);
  });

  it('allows only one check-in per person per day', async () => {
    await asUser(pool, alice, (client) =>
      client.query(
        `insert into public.checkins (couple_id, profile_id, on_date, interest)
         values ($1, $2, date '2026-06-01', 'yes')`,
        [coupleA, alice],
      ),
    );

    const error = await expectRejected(
      asUser(pool, alice, (client) =>
        client.query(
          `insert into public.checkins (couple_id, profile_id, on_date, interest)
           values ($1, $2, date '2026-06-01', 'not_tonight')`,
          [coupleA, alice],
        ),
      ),
    );

    expect(error.message).toMatch(/duplicate key|unique/i);
  });
});
