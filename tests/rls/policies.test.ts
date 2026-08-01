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
  await asUser(pool, bob, (c) => c.query('select public.join_couple($1)', [a.inviteCode]));

  const b = await createCouple(carol);
  coupleB = b.id;
  await asUser(pool, dave, (c) => c.query('select public.join_couple($1)', [b.inviteCode]));
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

    await asUser(pool, partner, (c) =>
      c.query('select public.join_couple($1)', [couple.inviteCode]),
    );
    const after = await currentInviteCode(fresh, couple.id);

    // A forwarded link or a screenshot in a camera roll must not be replayable.
    expect(after).not.toBe(couple.inviteCode);
  });

  it('refuses a third person', async () => {
    const code = await currentInviteCode(alice, coupleA);
    const error = await expectRejected(
      asUser(pool, eve, (c) => c.query('select public.join_couple($1)', [code])),
    );

    expect(error.message).toMatch(/couple is full/i);
  });

  it('refuses an invalid code', async () => {
    const error = await expectRejected(
      asUser(pool, eve, (c) => c.query('select public.join_couple($1)', ['ZZZZZZ'])),
    );

    expect(error.message).toMatch(/invalid invite code/i);
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

    expect(error.message).toMatch(/row-level security|at most two members/i);
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
